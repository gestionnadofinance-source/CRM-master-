/**
 * Dépose au coffre-fort les fiches de pointage d'un mois, chantier par
 * chantier et semaine par semaine, EN PASSANT PAR L'ÉCRAN DU CHEF DE
 * CHANTIER — le seul chemin dont dispose un vrai utilisateur.
 *
 * `depositEmployeeTimesheets` n'accepte pas de contexte d'acteur : elle exige
 * une requête HTTP authentifiée. Ce dépôt ne peut donc pas être scripté
 * autrement que par le navigateur, et c'est aussi bien : le rendu des PDF,
 * l'écriture du fichier et la création du dossier de coffre-fort sont
 * éprouvés tels qu'ils se produisent en usage réel.
 *
 * Usage : npx tsx scripts/qa/deposer-coffre-fort.ts <jeton du chef> [semaines...]
 */
import { chromium, type Page } from "playwright-core";

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = "http://localhost:3100";
const CRM_SLUG = "fidem-froid-clim";
const SEMAINES_FR = ["06/07/2026", "13/07/2026", "20/07/2026", "27/07/2026"];

/** Libellé de la semaine affichée, ex. « Semaine du 06/07/2026 au 12/07/2026 ». */
async function semaineAffichee(page: Page): Promise<string> {
  const texte = await page.locator("p", { hasText: /^Semaine du / }).first().innerText();
  return texte.replace(/^Semaine du\s+/, "").split(" au ")[0]!.trim();
}

async function allerALaSemaine(page: Page, cible: string): Promise<void> {
  // Bornes larges : douze semaines séparent la date du jour de juillet 2026,
  // mais le script doit rester correct si on le rejoue plus tard.
  for (let i = 0; i < 400; i++) {
    const courante = await semaineAffichee(page);
    if (courante === cible) return;
    const [jc, mc, ac] = courante.split("/").map(Number);
    const [jx, mx, ax] = cible.split("/").map(Number);
    const enAvance = new Date(ac!, mc! - 1, jc!) > new Date(ax!, mx! - 1, jx!);
    // Les chevrons ne portent qu'une icône, donc aucun nom accessible : on les
    // désigne par leur position immédiate autour du libellé de la semaine.
    const libelle = page.locator("p", { hasText: /^Semaine du / }).first();
    const bouton = libelle.locator(
      enAvance ? "xpath=preceding-sibling::button[1]" : "xpath=following-sibling::button[1]"
    );
    await bouton.click();
    await page.waitForTimeout(120);
  }
  throw new Error(`Semaine ${cible} introuvable par navigation.`);
}

async function main(): Promise<void> {
  const token = process.argv[2];
  if (!token) throw new Error("Jeton de session du chef de chantier requis.");

  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext();
  await context.addCookies([
    { name: "crm_master_session", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await context.newPage();
  const erreursConsole: string[] = [];
  page.on("pageerror", (e) => erreursConsole.push(e.message.slice(0, 120)));

  await page.goto(`${BASE}/c/${CRM_SLUG}/pointage-salaries`, { waitUntil: "domcontentloaded" });
  await page.locator("p", { hasText: /^Semaine du / }).first().waitFor({ timeout: 30_000 });

  const select = page.locator("select").first();
  const chantiers = await select.locator("option").evaluateAll((opts) =>
    opts.map((o) => ({ value: (o as HTMLOptionElement).value, nom: o.textContent?.trim() ?? "" }))
  );

  const resultats: Array<{ chantier: string; semaine: string; issue: string }> = [];

  for (const chantier of chantiers) {
    await select.selectOption(chantier.value);
    await page.waitForTimeout(400);

    for (const semaine of SEMAINES_FR) {
      await allerALaSemaine(page, semaine);

      const bouton = page.getByRole("button", { name: /Déposer au coffre-fort/ });
      if (await bouton.isDisabled()) {
        resultats.push({ chantier: chantier.nom, semaine, issue: "bouton désactivé (aucune fiche remplie)" });
        continue;
      }

      await bouton.click();
      // Le dépôt rend un PDF par salarié : laisser le temps, mais échouer
      // franchement plutôt que de passer à la suite sans savoir.
      const avis = page.locator("text=/Fiches déposées dans le coffre-fort|Erreur lors du dépôt|échec pour/").first();
      try {
        await avis.waitFor({ timeout: 120_000 });
        resultats.push({ chantier: chantier.nom, semaine, issue: (await avis.innerText()).slice(0, 120) });
      } catch {
        resultats.push({ chantier: chantier.nom, semaine, issue: "AUCUN RETOUR après 120 s" });
      }
      await page.waitForTimeout(300);
    }
    console.error(`${chantier.nom} : ${SEMAINES_FR.length} semaines traitées`);
  }

  const echecs = resultats.filter((r) => !r.issue.startsWith("Fiches déposées"));
  console.log(JSON.stringify({ total: resultats.length, echecs, erreursConsole, resultats }, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
