/**
 * Devis — calcul des totaux et numérotation, deux zones de logique métier
 * jusqu'ici non couvertes (voir l'audit : les modules devis, pipeline,
 * messagerie et réservation publique n'avaient aucun test automatisé).
 *
 * computeTotals est testée en pur (aucune dépendance base). generateQuoteNumber
 * est une intégration réelle contre Postgres via le client Prisma partagé,
 * sur le même principe que tests/isolation.test.ts : fixtures __TEST__
 * namespacées, nettoyées dans afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Crm } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeTotals } from "@/server/quotes/totals";
import { generateQuoteNumber } from "@/server/quotes/numbering";

describe("computeTotals", () => {
  it("calcule HT/TVA/TTC pour une seule ligne", () => {
    const result = computeTotals(
      [{ designation: "Prestation", quantity: 2, unitPriceHt: 100, vatRateId: "vat20" }],
      new Map([["vat20", 20]])
    );
    expect(result.totalHt).toBe(200);
    expect(result.totalVat).toBe(40);
    expect(result.totalTtc).toBe(240);
    expect(result.lines).toHaveLength(1);
  });

  it("cumule plusieurs lignes avec des taux de TVA différents", () => {
    const result = computeTotals(
      [
        { designation: "A", quantity: 1, unitPriceHt: 100, vatRateId: "vat20" },
        { designation: "B", quantity: 3, unitPriceHt: 50, vatRateId: "vat10" },
        { designation: "C", quantity: 1, unitPriceHt: 80, vatRateId: "vat0" },
      ],
      new Map([
        ["vat20", 20],
        ["vat10", 10],
        ["vat0", 0],
      ])
    );
    // HT: 100 + 150 + 80 = 330 ; TVA: 20 + 15 + 0 = 35 ; TTC: 365
    expect(result.totalHt).toBe(330);
    expect(result.totalVat).toBe(35);
    expect(result.totalTtc).toBe(365);
  });

  it("arrondit à 2 décimales même avec des quantités non entières", () => {
    const result = computeTotals(
      [{ designation: "Prestation", quantity: 1.5, unitPriceHt: 33.33, vatRateId: "vat20" }],
      new Map([["vat20", 20]])
    );
    // HT brut = 49.995 -> arrondi 50 ; TVA brute = 9.999 -> arrondi 10 ; TTC = 59.994 -> arrondi 59.99 (calculé sur le total brut, pas sur les valeurs déjà arrondies)
    expect(result.totalHt).toBe(50);
    expect(result.totalVat).toBe(10);
    expect(result.totalTtc).toBe(59.99);
  });

  it("traite un taux de TVA inconnu comme 0% plutôt que d'échouer", () => {
    const result = computeTotals(
      [{ designation: "Prestation", quantity: 1, unitPriceHt: 100, vatRateId: "taux-inexistant" }],
      new Map([["vat20", 20]])
    );
    expect(result.totalHt).toBe(100);
    expect(result.totalVat).toBe(0);
    expect(result.totalTtc).toBe(100);
  });

  it("renvoie des totaux nuls pour une liste vide", () => {
    const result = computeTotals([], new Map());
    expect(result).toMatchObject({ totalHt: 0, totalVat: 0, totalTtc: 0, lines: [] });
  });
});

describe("generateQuoteNumber", () => {
  const SLUG = "__test__-quotes-numbering";
  let crm: Crm;

  beforeAll(async () => {
    await prisma.quoteCounter.deleteMany({ where: { crm: { slug: SLUG } } });
    await prisma.crm.deleteMany({ where: { slug: SLUG } });
    crm = await prisma.crm.create({ data: { name: "__TEST__ Quotes Numbering", slug: SLUG } });
  });

  afterAll(async () => {
    await prisma.quoteCounter.deleteMany({ where: { crmId: crm.id } });
    await prisma.crm.delete({ where: { id: crm.id } });
  });

  it("génère un numéro au format PREFIX-ANNEE-00001 pour un CRM sans compteur existant", async () => {
    const number = await generateQuoteNumber(crm.id, "TST");
    const year = new Date().getFullYear();
    expect(number).toBe(`TST-${year}-00001`);
  });

  it("incrémente séquentiellement pour les appels suivants avec le même préfixe", async () => {
    const n2 = await generateQuoteNumber(crm.id, "TST");
    const n3 = await generateQuoteNumber(crm.id, "TST");
    const year = new Date().getFullYear();
    expect(n2).toBe(`TST-${year}-00002`);
    expect(n3).toBe(`TST-${year}-00003`);
  });

  it("retrouve automatiquement le préfixe déjà attribué au CRM si aucun n'est fourni", async () => {
    const number = await generateQuoteNumber(crm.id);
    const year = new Date().getFullYear();
    expect(number).toBe(`TST-${year}-00004`);
  });

  it("génère des numéros uniques même sous appels concurrents (incrémentation atomique)", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => generateQuoteNumber(crm.id, "TST")));
    expect(new Set(results).size).toBe(10);
  });

  it("maintient des séquences indépendantes par préfixe", async () => {
    const numberOther = await generateQuoteNumber(crm.id, "AUTRE");
    const year = new Date().getFullYear();
    expect(numberOther).toBe(`AUTRE-${year}-00001`);
  });
});
