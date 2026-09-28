/**
 * Phase 11 — concurrence, éprouvée à travers toute la pile HTTP.
 *
 * L'écriture d'une fiche de pointage est le seul chemin d'écriture réellement
 * concurrent de l'ERP : plusieurs chefs de chantier peuvent saisir la même
 * semaine du même salarié depuis des appareils différents, et l'API publique
 * expose ce même chemin. On y cherche ce qui fait vraiment mal : une ligne
 * dupliquée malgré la contrainte d'unicité, une erreur 500 au lieu d'un refus
 * propre, ou une donnée à moitié écrite.
 *
 * Usage : npx tsx scripts/qa/concurrence.ts <url de base> <clé API>
 */
import "dotenv/config";
import { createScriptPrismaClient } from "../../prisma/client";

const CRM_SLUG = "fidem-froid-clim";

interface Tir {
  statut: number | string;
  corps: string;
}

async function tirer(url: string, cle: string, charge: unknown): Promise<Tir> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${cle}`, "content-type": "application/json" },
      body: JSON.stringify(charge),
    });
    return { statut: res.status, corps: (await res.text()).slice(0, 120) };
  } catch (err) {
    return { statut: "réseau", corps: err instanceof Error ? err.message.slice(0, 80) : "" };
  }
}

function repartition(tirs: Tir[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tirs) out[String(t.statut)] = (out[String(t.statut)] ?? 0) + 1;
  return out;
}

const jours = (lundi: string, heures: number) => {
  const base = new Date(`${lundi}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), normal: i < 5 ? heures : 0, matin: 0, apresMidi: 0, nuit: 0 };
  });
};

async function main(): Promise<void> {
  const base = process.argv[2] ?? "http://localhost:3100";
  const cle = process.argv[3];
  if (!cle) throw new Error("Clé API requise en second argument.");
  const url = `${base}/api/public/v1/pointages`;

  const prisma = createScriptPrismaClient();
  const crm = await prisma.crm.findUniqueOrThrow({ where: { slug: CRM_SLUG } });
  const chantier = await prisma.chantier.findFirstOrThrow({ where: { crmId: crm.id, name: "QA Chantier 1" } });
  const employe = await prisma.user.findUniqueOrThrow({ where: { email: "qa.alpha@qa.local" } });

  const rapport: Record<string, unknown> = {};

  // --- Scénario 1 : N écritures SIMULTANÉES de la MÊME fiche --------------
  // Attendu : une seule ligne en base, aucune 500, aucun doublon.
  for (const n of [2, 5, 10, 25, 50]) {
    const lundi = "2026-09-07";
    await prisma.pointage.deleteMany({ where: { chantierId: chantier.id, employeeId: employe.id, weekStart: new Date(`${lundi}T00:00:00Z`) } });

    const tirs = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        tirer(url, cle, {
          crmId: crm.id,
          chantierId: chantier.id,
          employeeId: employe.id,
          weekStart: lundi,
          days: jours(lundi, 7 + (i % 3)), // valeurs différentes : on veut voir laquelle gagne
          hourlyRate: 12,
          nightRatePercent: 25,
        })
      )
    );

    const lignes = await prisma.pointage.count({
      where: { chantierId: chantier.id, employeeId: employe.id, weekStart: new Date(`${lundi}T00:00:00Z`) },
    });
    const echecs = tirs.filter((t) => typeof t.statut === "number" && t.statut >= 500);
    rapport[`meme_fiche_x${n}`] = {
      lignesEnBase: lignes,
      repartition: repartition(tirs),
      exemplesErreur500: echecs.slice(0, 2).map((t) => t.corps),
    };
    console.error(`même fiche ×${n} → ${lignes} ligne(s) en base · ${JSON.stringify(repartition(tirs))}`);
  }

  // --- Scénario 2 : N écritures simultanées de fiches DIFFÉRENTES ---------
  // Attendu : toutes réussissent, aucune ne s'écrase.
  const semaines = Array.from({ length: 20 }, (_, i) => {
    const d = new Date("2026-01-05T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i * 7);
    return d.toISOString().slice(0, 10);
  });
  await prisma.pointage.deleteMany({
    where: { chantierId: chantier.id, employeeId: employe.id, weekStart: { in: semaines.map((s) => new Date(`${s}T00:00:00Z`)) } },
  });
  const tirs2 = await Promise.all(
    semaines.map((lundi) =>
      tirer(url, cle, {
        crmId: crm.id,
        chantierId: chantier.id,
        employeeId: employe.id,
        weekStart: lundi,
        days: jours(lundi, 7),
        hourlyRate: 12,
        nightRatePercent: 25,
      })
    )
  );
  const ecrites = await prisma.pointage.count({
    where: { chantierId: chantier.id, employeeId: employe.id, weekStart: { in: semaines.map((s) => new Date(`${s}T00:00:00Z`)) } },
  });
  rapport.fiches_differentes_x20 = { attendu: semaines.length, ecrites, repartition: repartition(tirs2) };
  console.error(`fiches différentes ×20 → ${ecrites}/20 écrites · ${JSON.stringify(repartition(tirs2))}`);

  // --- Nettoyage ----------------------------------------------------------
  await prisma.pointage.deleteMany({
    where: {
      chantierId: chantier.id,
      employeeId: employe.id,
      weekStart: { in: [...semaines, "2026-09-07"].map((s) => new Date(`${s}T00:00:00Z`)) },
    },
  });

  console.log(JSON.stringify(rapport, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
