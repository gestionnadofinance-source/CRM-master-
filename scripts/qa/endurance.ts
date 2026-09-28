/**
 * Phase 12 — endurance : charge soutenue sur une longue durée, pour faire
 * apparaître ce qu'un test court ne montre jamais.
 *
 * On cherche des tendances, pas des pics : mémoire du serveur qui monte sans
 * jamais redescendre, connexions à la base qui ne sont pas rendues, temps de
 * réponse qui dérive, erreurs qui n'apparaissent qu'au bout d'un moment,
 * tables qui gonflent sans borne.
 *
 * Le trafic mêle lecture et ÉCRITURE : une fuite se loge plus volontiers dans
 * un chemin qui écrit (journal d'activité, sessions, transactions) que dans
 * une page en lecture seule.
 *
 * Usage :
 *   npx tsx scripts/qa/endurance.ts <url> <cookie> <clé API> <pid> <minutes> [concurrence]
 */
import "dotenv/config";
import { execFileSync } from "child_process";
import { createScriptPrismaClient } from "../../prisma/client";

const CRM_SLUG = "fidem-froid-clim";
const INTERVALLE_MESURE_MS = 30_000;

interface Mesure {
  minute: number;
  rssMo: number;
  connexionsPg: number;
  requetes: number;
  erreurs: number;
  p50: number;
  p95: number;
  sessions: number;
  journalActivite: number;
  pointages: number;
}

function rssMo(pid: string): number {
  try {
    const out = execFileSync("ps", ["-o", "rss=", "-p", pid], { encoding: "utf8" }).trim();
    return Math.round(Number(out) / 1024);
  } catch {
    return -1;
  }
}

function percentile(latences: number[], p: number): number {
  if (latences.length === 0) return 0;
  const s = [...latences].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!);
}

const jours = (lundi: string) => {
  const base = new Date(`${lundi}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), normal: i < 5 ? 7 : 0, matin: 0, apresMidi: 0, nuit: 0 };
  });
};

async function main(): Promise<void> {
  const [base, cookie, cle, pid, minutesArg, concurrenceArg] = process.argv.slice(2);
  if (!base || !pid) throw new Error("Usage : <url> <cookie> <clé> <pid> <minutes> [concurrence]");
  const minutes = Number(minutesArg ?? 30);
  const concurrence = Number(concurrenceArg ?? 8);

  const prisma = createScriptPrismaClient();
  const crm = await prisma.crm.findUniqueOrThrow({ where: { slug: CRM_SLUG } });
  const chantier = await prisma.chantier.findFirstOrThrow({ where: { crmId: crm.id, name: "QA Chantier 1" } });
  const employe = await prisma.user.findUniqueOrThrow({ where: { email: "qa.alpha@qa.local" } });

  // Semaines de 2027 : hors de tout mois exporté, pour ne rien perturber.
  const semaines = Array.from({ length: 52 }, (_, i) => {
    const d = new Date("2027-01-04T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i * 7);
    return d.toISOString().slice(0, 10);
  });

  const fin = Date.now() + minutes * 60_000;
  let latences: number[] = [];
  let requetes = 0;
  let erreurs = 0;
  let compteur = 0;
  const mesures: Mesure[] = [];

  async function worker(): Promise<void> {
    while (Date.now() < fin) {
      const n = compteur++;
      const t0 = performance.now();
      try {
        let res: Response;
        // Une écriture toutes les quatre requêtes : assez pour solliciter le
        // chemin transactionnel sans transformer le test en test d'écriture.
        if (n % 4 === 3) {
          const lundi = semaines[n % semaines.length]!;
          res = await fetch(`${base}/api/public/v1/pointages`, {
            method: "POST",
            headers: { authorization: `Bearer ${cle}`, "content-type": "application/json" },
            body: JSON.stringify({
              crmId: crm.id,
              chantierId: chantier.id,
              employeeId: employe.id,
              weekStart: lundi,
              days: jours(lundi),
              hourlyRate: 12,
              nightRatePercent: 25,
            }),
          });
        } else if (n % 4 === 1) {
          res = await fetch(`${base}/api/public/v1/pointages?perPage=25`, {
            headers: { authorization: `Bearer ${cle}` },
          });
        } else {
          res = await fetch(`${base}/c/${CRM_SLUG}/planning`, { headers: { cookie: cookie ?? "" }, redirect: "manual" });
        }
        await res.arrayBuffer();
        if (res.status >= 400) erreurs++;
      } catch {
        erreurs++;
      }
      latences.push(performance.now() - t0);
      requetes++;
    }
  }

  const depart = Date.now();
  const echantillonneur = setInterval(async () => {
    const [sessions, journal, pointages, pg] = await Promise.all([
      prisma.session.count(),
      prisma.activityLog.count(),
      prisma.pointage.count(),
      prisma.$queryRawUnsafe<Array<{ n: bigint }>>("select count(*)::bigint as n from pg_stat_activity"),
    ]);
    const m: Mesure = {
      minute: Math.round((Date.now() - depart) / 6000) / 10,
      rssMo: rssMo(pid!),
      connexionsPg: Number(pg[0]?.n ?? 0),
      requetes,
      erreurs,
      p50: percentile(latences, 50),
      p95: percentile(latences, 95),
      sessions,
      journalActivite: journal,
      pointages,
    };
    mesures.push(m);
    console.error(
      `t+${String(m.minute).padStart(5)} min · RSS ${String(m.rssMo).padStart(4)} Mo · ` +
        `pg ${String(m.connexionsPg).padStart(2)} · ${String(m.requetes).padStart(6)} req · ` +
        `${m.erreurs} err · p50 ${String(m.p50).padStart(4)} ms · p95 ${String(m.p95).padStart(5)} ms · ` +
        `journal ${m.journalActivite}`
    );
    // Fenêtre glissante : chaque mesure de latence porte sur la période
    // écoulée, sinon une dérive tardive serait noyée dans la moyenne.
    latences = [];
  }, INTERVALLE_MESURE_MS);

  await Promise.all(Array.from({ length: concurrence }, () => worker()));
  clearInterval(echantillonneur);

  // --- Nettoyage : les fiches écrites pendant le test ----------------------
  const supprimes = await prisma.pointage.deleteMany({
    where: { chantierId: chantier.id, employeeId: employe.id, weekStart: { in: semaines.map((s) => new Date(`${s}T00:00:00Z`)) } },
  });

  const premier = mesures[0];
  const dernier = mesures[mesures.length - 1];
  console.log(
    JSON.stringify(
      {
        duree: `${minutes} min`,
        concurrence,
        totalRequetes: requetes,
        totalErreurs: erreurs,
        memoire: { debutMo: premier?.rssMo, finMo: dernier?.rssMo, deltaMo: (dernier?.rssMo ?? 0) - (premier?.rssMo ?? 0) },
        connexionsPg: { debut: premier?.connexionsPg, fin: dernier?.connexionsPg },
        latence: { p50Debut: premier?.p50, p50Fin: dernier?.p50, p95Debut: premier?.p95, p95Fin: dernier?.p95 },
        journalActivite: { debut: premier?.journalActivite, fin: dernier?.journalActivite },
        fichesSupprimeesApresTest: supprimes.count,
        mesures,
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
