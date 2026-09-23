/**
 * API publique d'écriture — traduction des erreurs inattendues (BUG-002).
 *
 * withWriteErrorHandling renvoyait `err.message` tel quel en 400 pour
 * toute erreur non-AuthError. Les server actions réutilisées par ces
 * routes rendent pourtant leurs erreurs métier dans un `ActionResult` :
 * ce qui arrivait là était donc interne (requête Prisma, nom de colonne,
 * trace de connexion) et partait au client. Le détail va désormais au
 * journal serveur, l'appelant reçoit un libellé stable.
 */
import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { AuthError } from "@/server/auth/session";
import { withWriteErrorHandling } from "@/server/public-api/write-helpers";

function thrower(err: unknown) {
  return () =>
    withWriteErrorHandling(async () => {
      throw err;
    });
}

describe("withWriteErrorHandling", () => {
  it("n'expose plus le message d'une erreur interne", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = 'Invalid `prisma.client.create()`: column "passwordHash" violates constraint';

    const res = await thrower(new Error(secret))();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Erreur interne.");
    expect(JSON.stringify(body)).not.toContain("prisma");
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    // ...mais le détail reste disponible côté serveur pour le diagnostic.
    expect(spy.mock.calls.flat().some((a) => a instanceof Error && a.message === secret)).toBe(true);
    spy.mockRestore();
  });

  it("garde un 4xx exploitable pour les erreurs Prisma dues à la requête", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: Array<[string, number, string]> = [
      ["P2025", 404, "Ressource introuvable."],
      ["P2002", 409, "Une ressource équivalente existe déjà."],
      ["P2003", 400, "Requête invalide : référence ou valeur incorrecte."],
      ["P2000", 400, "Requête invalide : référence ou valeur incorrecte."],
    ];
    for (const [code, status, message] of cases) {
      const err = Object.assign(new Error(`détail interne pour ${code}`), { code });
      const res = await thrower(err)();
      expect(res.status, code).toBe(status);
      expect((await res.json()).error, code).toBe(message);
    }
    spy.mockRestore();
  });

  it("traduit toujours AuthError selon son code", async () => {
    for (const [code, status] of [["FORBIDDEN", 403], ["CRM_ACCESS_DENIED", 404], ["UNAUTHENTICATED", 401]] as const) {
      const res = await thrower(new AuthError(code, "refusé"))();
      expect(res.status, code).toBe(status);
    }
  });

  it("laisse passer une réponse normale", async () => {
    const res = await withWriteErrorHandling(async () => NextResponse.json({ ok: true }, { status: 201 }));
    expect(res.status).toBe(201);
  });
});
