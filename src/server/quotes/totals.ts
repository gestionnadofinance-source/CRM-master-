import "server-only";

export interface QuoteTotalsInputItem {
  designation: string;
  quantity: number;
  unitPriceHt: number;
  vatRateId: string;
}

export interface ComputedTotals {
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  lines: Array<{ designation: string; quantity: number; unitPriceHt: number; vatRateId: string; lineHt: number; lineVat: number }>;
}

/**
 * Recalcule intégralement les totaux d'un devis côté serveur — jamais
 * confiance aux totaux envoyés par le client. Isolée dans son propre
 * module (plutôt qu'inline dans actions.ts, qui est "use server" — Next.js
 * exige que toute fonction exportée d'un tel fichier soit async, ce qui
 * exclurait ce pur calcul) afin d'être testable directement, voir
 * tests/quotes.test.ts.
 */
export function computeTotals(items: QuoteTotalsInputItem[], vatRatesById: Map<string, number>): ComputedTotals {
  let totalHt = 0;
  let totalVat = 0;
  const lines = items.map((item) => {
    const rate = vatRatesById.get(item.vatRateId) ?? 0;
    const lineHt = item.quantity * item.unitPriceHt;
    const lineVat = lineHt * (rate / 100);
    totalHt += lineHt;
    totalVat += lineVat;
    return { designation: item.designation, quantity: item.quantity, unitPriceHt: item.unitPriceHt, vatRateId: item.vatRateId, lineHt, lineVat };
  });
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return { totalHt: round2(totalHt), totalVat: round2(totalVat), totalTtc: round2(totalHt + totalVat), lines };
}
