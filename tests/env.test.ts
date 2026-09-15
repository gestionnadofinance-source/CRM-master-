/**
 * Validation des variables d'environnement serveur (src/lib/env.ts).
 *
 * Couvre le cas d'un tableau de bord d'hébergeur qui enregistre une variable
 * déclarée mais laissée vide comme une chaîne vide, là où process.env ne
 * contiendrait pas la clé du tout en local : `.default()` et `.optional()` de
 * zod ne se déclenchant que sur `undefined`, une variable vide faisait
 * auparavant soit échouer le build (STORAGE_DRIVER), soit passer une valeur
 * absurde en silence (SESSION_TTL_HOURS vide, coercé en 0).
 *
 * getServerEnv() mémoïse son résultat : chaque cas réinitialise donc le cache
 * de modules avant de réimporter le module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_DATABASE_URL = "postgresql://user:password@localhost:5432/db?schema=public";

let savedEnv: NodeJS.ProcessEnv;

/** Recharge src/lib/env.ts avec un process.env neuf (cache de getServerEnv inclus). */
async function loadEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  const mod = await import("@/lib/env");
  return mod.getServerEnv();
}

beforeEach(() => {
  savedEnv = { ...process.env };
  process.env.DATABASE_URL = VALID_DATABASE_URL;
});

afterEach(() => {
  process.env = savedEnv;
  vi.resetModules();
});

describe("getServerEnv — variables absentes", () => {
  it("applique les valeurs par défaut", async () => {
    const env = await loadEnv({ STORAGE_DRIVER: undefined, SESSION_TTL_HOURS: undefined });
    expect(env.STORAGE_DRIVER).toBe("local");
    expect(env.SESSION_TTL_HOURS).toBe(12);
  });
});

describe("getServerEnv — variables déclarées mais vides", () => {
  it("traite une chaîne vide comme une absence plutôt que d'échouer (STORAGE_DRIVER)", async () => {
    const env = await loadEnv({ STORAGE_DRIVER: "" });
    expect(env.STORAGE_DRIVER).toBe("local");
  });

  it("n'accepte jamais une durée de session nulle, qui expirerait toute session à sa création", async () => {
    const env = await loadEnv({ SESSION_TTL_HOURS: "" });
    expect(env.SESSION_TTL_HOURS).toBe(12);
    expect(env.SESSION_TTL_HOURS).toBeGreaterThan(0);
  });

  it("traite une valeur uniquement composée d'espaces comme une absence", async () => {
    const env = await loadEnv({ STORAGE_DRIVER: "   ", SMTP_HOST: "  " });
    expect(env.STORAGE_DRIVER).toBe("local");
    expect(env.SMTP_HOST).toBeUndefined();
  });

  it("laisse isEmailConfigured() à false quand les variables SMTP sont vides", async () => {
    for (const [k, v] of Object.entries({ SMTP_HOST: "", SMTP_USER: "", SMTP_PASSWORD: "" })) {
      process.env[k] = v;
    }
    vi.resetModules();
    const mod = await import("@/lib/env");
    expect(mod.isEmailConfigured()).toBe(false);
  });
});

describe("getServerEnv — espaces de bord", () => {
  it("tolère un saut de ligne ajouté par un copier-coller", async () => {
    const env = await loadEnv({ STORAGE_DRIVER: "vercel-blob\n" });
    expect(env.STORAGE_DRIVER).toBe("vercel-blob");
  });

  it("nettoie aussi les valeurs libres", async () => {
    const env = await loadEnv({ APP_URL: "  https://exemple.fr  " });
    expect(env.APP_URL).toBe("https://exemple.fr");
  });
});

describe("getServerEnv — valeurs réellement invalides", () => {
  it("échoue toujours sur une valeur d'énumération inconnue", async () => {
    await expect(loadEnv({ STORAGE_DRIVER: "dropbox" })).rejects.toThrow(/STORAGE_DRIVER/);
  });

  it("échoue toujours sur DATABASE_URL manquante", async () => {
    await expect(loadEnv({ DATABASE_URL: undefined })).rejects.toThrow(/DATABASE_URL/);
  });
});
