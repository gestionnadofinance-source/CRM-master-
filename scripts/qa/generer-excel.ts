/**
 * Génère le tableau Excel mensuel de chaque salarié EN PASSANT PAR L'ÉCRAN
 * COFFRE-FORT, seul chemin dont dispose la secrétaire : sélectionner les
 * fiches de pointage déposées, puis « Transformer en tableau de comptabilité ».
 *
 * generateAccountingExport exige une requête HTTP authentifiée, comme le
 * dépôt : elle n'est pas scriptable autrement que par le navigateur.
 *
 * Usage : npx tsx scripts/qa/generer-excel.ts <jeton admin> [nombre de salariés]
 */
import { chromium, type Page } from "playwright-core";

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = "http://localhost:3100";
const CRM_SLUG = "fidem-froid-clim";

async function traiterSalarie(page: Page, nom: string): Promise<string> {
  await page.goto(`${BASE}/c/${CRM_SLUG}/vault`, { waitUntil: "domcontentloaded" });

  // Attendre que la liste des membres soit rendue avant de chercher le
  // salarié : sans cela, on cherche dans une page encore vide.
  await page.locator("button", { hasText: /EMP\d{2}/ }).first().waitFor({ timeout: 60_000 });
  const ligne = page.locator("button", { hasText: nom }).first();
  await ligne.waitFor({ timeout: 30_000 });
  await ligne.click();
  await page.getByText(/^Coffre-fort de /).waitFor({ timeout: 30_000 });
  // Puis que l'arborescence du coffre-fort le soit aussi : la lire trop tôt
  // renvoie une racine vide et fait conclure à tort qu'il n'y a rien.
  await page
    .locator("text=/^\\d{2}\\/\\d{2}\\/\\d{4} — /")
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => undefined);

  // Le coffre-fort range chaque fiche dans un dossier « date — chantier », et
  // la racine est vide : il faut entrer dans chaque dossier pour atteindre la
  // fiche. La sélection est conservée d'un dossier à l'autre, ce qui permet de
  // produire un seul tableau couvrant tout le mois.
  const arborescence = await page.locator("main").innerText();
  const dossiers = Array.from(new Set(arborescence.split("\n").map((l) => l.trim()).filter((l) => /^\d{2}\/\d{2}\/\d{4} — /.test(l))));
  if (dossiers.length === 0) return "AUCUN dossier de fiches dans ce coffre-fort";

  let cochees = 0;
  for (const dossier of dossiers) {
    // Entrer dans un dossier fait descendre d'un niveau : les dossiers frères
    // ne sont plus listés. Il faut donc remonter à la racine entre chacun.
    await page.locator(`text=${dossier}`).first().click();
    await page.waitForTimeout(300);
    const cases = page.locator('input[type="checkbox"]');
    const nb = await cases.count();
    for (let i = 0; i < nb; i++) {
      const c = cases.nth(i);
      if ((await c.isVisible()) && !(await c.isChecked())) {
        await c.check().catch(() => undefined);
        cochees++;
      }
    }
    await page.locator("text=Racine").first().click().catch(() => undefined);
    await page.waitForTimeout(250);
  }
  if (cochees === 0) return `AUCUNE fiche cochée (${dossiers.length} dossier(s))`;

  const bouton = page.getByRole("button", { name: /Transformer en tableau de comptabilité/ });
  if ((await bouton.count()) === 0) return `bouton absent (${cochees} case(s) cochées)`;
  await bouton.click();

  const avis = page.locator("text=/Tableau généré et déposé|Erreur|impossible/").first();
  try {
    await avis.waitFor({ timeout: 120_000 });
    return (await avis.innerText()).slice(0, 120);
  } catch {
    return "AUCUN RETOUR après 120 s";
  }
}

async function main(): Promise<void> {
  const token = process.argv[2];
  const limite = Number(process.argv[3] ?? 40);
  if (!token) throw new Error("Jeton de session requis.");

  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext();
  await context.addCookies([
    { name: "crm_master_session", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  const erreursConsole: string[] = [];
  const resultats: Array<{ salarie: string; issue: string }> = [];

  for (let i = 1; i <= limite; i++) {
    const nom = `EMP${String(i).padStart(2, "0")}`;
    // Un onglet neuf par salarié : réutiliser le même laissait un état
    // résiduel qui empêchait la liste des membres de se rendre au tour
    // suivant. Isoler coûte une seconde et supprime la question.
    const page = await context.newPage();
    page.on("pageerror", (e) => erreursConsole.push(e.message.slice(0, 120)));
    try {
      const issue = await traiterSalarie(page, nom);
      resultats.push({ salarie: nom, issue });
      console.error(`${nom} → ${issue}`);
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 120) : "erreur";
      resultats.push({ salarie: nom, issue: `EXCEPTION : ${message}` });
      console.error(`${nom} → EXCEPTION ${message}`);
    } finally {
      await page.close();
    }
  }

  const echecs = resultats.filter((r) => !r.issue.startsWith("Tableau généré"));
  console.log(JSON.stringify({ total: resultats.length, echecs, erreursConsole, resultats }, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
