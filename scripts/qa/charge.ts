/**
 * Montée en charge par paliers sur un serveur LOCAL (build de production).
 *
 * Mesure, pour chaque palier de concurrence, le débit réel, le taux d'erreur
 * et la distribution des temps de réponse. Le but n'est pas de produire un
 * chiffre flatteur mais de trouver le palier où le comportement CHANGE :
 * apparition d'erreurs, ou temps de réponse qui décroche.
 *
 * Les seuils obtenus valent pour cette machine et cette base locale. Ils ne
 * transposent pas à Vercel + Neon, dont ni le nombre de connexions ni la
 * latence réseau ne sont reproduits ici.
 *
 * Usage : npx tsx scripts/qa/charge.ts <url> <cookie> [secondes par palier]
 */
const LEVELS = [1, 2, 5, 10, 25, 50, 100, 250];

interface LevelResult {
  concurrence: number;
  requetes: number;
  erreurs: number;
  tauxErreur: string;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  codes: Record<string, number>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[i]!);
}

async function runLevel(url: string, cookie: string, concurrence: number, seconds: number): Promise<LevelResult> {
  const deadline = Date.now() + seconds * 1000;
  const latences: number[] = [];
  const codes: Record<string, number> = {};
  let erreurs = 0;

  async function worker(): Promise<void> {
    while (Date.now() < deadline) {
      const t0 = performance.now();
      try {
        // Le second argument porte soit un cookie de session, soit une clé
        // API (« Bearer ... ») : les deux chemins d'authentification de
        // l'application doivent pouvoir être mesurés.
        const headers: Record<string, string> = cookie.startsWith("Bearer ")
          ? { authorization: cookie }
          : { cookie };
        const res = await fetch(url, { headers, redirect: "manual" });
        await res.arrayBuffer();
        const code = String(res.status);
        codes[code] = (codes[code] ?? 0) + 1;
        // 2xx et 3xx sont des réponses valides ; au-delà, c'est une erreur.
        if (res.status >= 400) erreurs++;
      } catch (err) {
        erreurs++;
        const label = err instanceof Error ? err.message.slice(0, 40) : "erreur";
        codes[label] = (codes[label] ?? 0) + 1;
      }
      latences.push(performance.now() - t0);
    }
  }

  await Promise.all(Array.from({ length: concurrence }, () => worker()));

  const sorted = [...latences].sort((a, b) => a - b);
  return {
    concurrence,
    requetes: latences.length,
    erreurs,
    tauxErreur: `${((erreurs / Math.max(1, latences.length)) * 100).toFixed(1)} %`,
    rps: Math.round(latences.length / seconds),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
    codes,
  };
}

async function main(): Promise<void> {
  const url = process.argv[2];
  const cookie = process.argv[3] ?? "";
  const seconds = Number(process.argv[4] ?? 6);
  if (!url) throw new Error("URL requise.");

  const results: LevelResult[] = [];
  for (const concurrence of LEVELS) {
    const r = await runLevel(url, cookie, concurrence, seconds);
    results.push(r);
    console.error(
      `palier ${String(concurrence).padStart(3)} : ${String(r.rps).padStart(4)} req/s · ` +
        `p50 ${String(r.p50).padStart(5)} ms · p95 ${String(r.p95).padStart(5)} ms · ` +
        `erreurs ${r.tauxErreur}`
    );
    // Laisse le serveur retomber au repos entre deux paliers, pour que le
    // palier suivant mesure bien sa propre charge.
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(JSON.stringify({ url, secondesParPalier: seconds, paliers: results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
