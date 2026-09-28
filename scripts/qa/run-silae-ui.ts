/**
 * Génère l'export Silae d'un mois PAR L'INTERFACE, comme le ferait la
 * secrétaire — donc en passant par collectMonth, le rapport de contrôle et
 * le téléchargement, que les tests unitaires ne peuvent pas atteindre (une
 * server action exige un contexte de requête HTTP).
 *
 * Usage : npx tsx scripts/qa/run-silae-ui.ts <jeton de session> [AAAA-MM]
 * Écrit le CSV téléchargé et le rapport dans le dossier de sortie indiqué.
 */
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = "http://localhost:3000";
const CRM_SLUG = "fidem-froid-clim";

async function main(): Promise<void> {
  const token = process.argv[2];
  const month = process.argv[3] ?? "2026-07";
  const outDir = process.argv[4] ?? "/tmp/silae-qa";
  if (!token) throw new Error("Jeton de session requis en premier argument.");
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addCookies([
    { name: "crm_master_session", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}/c/${CRM_SLUG}/silae`, { waitUntil: "domcontentloaded" });

  // Le champ est un <input type="month"> contrôlé par React. Ni `fill()` ni
  // l'écriture via le setter natif ne déclenchent son onChange : React
  // réaffiche aussitôt son état, qui reste sur le mois par défaut. La saisie
  // au clavier, segment par segment comme le ferait une personne, est le seul
  // pilotage fidèle — et c'est aussi ce qu'on veut tester.
  const [y, m] = month.split("-");
  await page.locator("#month").click();
  await page.keyboard.type(`${m}${y}`);
  await page.waitForTimeout(200);
  const applied = await page.inputValue("#month");
  if (applied !== month) throw new Error(`Le mois retenu par l'écran (${applied}) n'est pas ${month}.`);

  await page.getByRole("button", { name: "Vérifier" }).click();

  // Le rapport remplace le bouton par « Calcul en cours... » le temps de
  // l'agrégation : on attend son retour à l'état stable.
  await page.getByRole("button", { name: "Vérifier" }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(500);

  const reportText = await page.locator("main").innerText();
  await writeFile(path.join(outDir, `rapport-${month}.txt`), reportText, "utf8");
  await page.screenshot({ path: path.join(outDir, `rapport-${month}.png`), fullPage: true });

  const downloadButton = page.getByRole("button", { name: /Télécharger le CSV/ });
  const disabled = await downloadButton.isDisabled();
  let csvPath: string | null = null;
  if (!disabled) {
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), downloadButton.click()]);
    csvPath = path.join(outDir, download.suggestedFilename());
    await download.saveAs(csvPath);
  }

  console.log(
    JSON.stringify(
      {
        mois: month,
        telechargementBloque: disabled,
        csv: csvPath,
        rapport: path.join(outDir, `rapport-${month}.txt`),
        erreursConsole: consoleErrors,
      },
      null,
      2
    )
  );

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
