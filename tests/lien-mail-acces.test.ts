/**
 * Lien « Se connecter » des mails d'accès : il doit mener à la page de
 * connexion de l'application, jamais à l'adresse d'un déploiement Vercel
 * particulier (protégée par Vercel, et remplacée à chaque mise en ligne).
 */
import { describe, expect, it } from "vitest";
import { loginUrlFor, resolveAppOrigin } from "@/server/admin/welcome-email";

const DEPLOIEMENT = "https://crm-master-cepam1zv4-nado5.vercel.app";

describe("adresse des liens envoyés par mail", () => {
  it("sur Vercel : le domaine de production, pas l'adresse du déploiement utilisé par l'administrateur", () => {
    const env = { VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "crm-master-nado5.vercel.app" };
    expect(resolveAppOrigin(env, DEPLOIEMENT, "http://localhost:3000")).toBe("https://crm-master-nado5.vercel.app");
    expect(loginUrlFor(resolveAppOrigin(env, DEPLOIEMENT, ""), "a@b.fr")).toBe(
      "https://crm-master-nado5.vercel.app/login?email=a%40b.fr"
    );
  });

  it("APP_URL explicite l'emporte (domaine personnalisé)", () => {
    const env = { VERCEL: "1", APP_URL: "https://crm.fidem.fr/", VERCEL_PROJECT_PRODUCTION_URL: "crm-master-nado5.vercel.app" };
    expect(resolveAppOrigin(env, DEPLOIEMENT, "")).toBe("https://crm.fidem.fr");
  });

  it("une APP_URL qui pointe vers Vercel ou localhost en production est écartée", () => {
    for (const APP_URL of ["https://vercel.com/nado5/crm-master", "http://localhost:3000", "pas une adresse"]) {
      const env = { VERCEL: "1", APP_URL, VERCEL_PROJECT_PRODUCTION_URL: "crm-master-nado5.vercel.app" };
      expect(resolveAppOrigin(env, DEPLOIEMENT, ""), APP_URL).toBe("https://crm-master-nado5.vercel.app");
    }
  });

  it("hors Vercel : APP_URL, sinon l'adresse de la requête", () => {
    expect(resolveAppOrigin({ APP_URL: "http://localhost:3100" }, null, "x")).toBe("http://localhost:3100");
    expect(resolveAppOrigin({}, "https://crm.exemple.fr", "x")).toBe("https://crm.exemple.fr");
  });
});
