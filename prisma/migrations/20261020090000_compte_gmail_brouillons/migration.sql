-- Compte Gmail relié par un administrateur pour préparer les brouillons de
-- bienvenue des nouveaux utilisateurs (portée gmail.compose : jamais d'envoi).
CREATE TABLE "GoogleMailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "GoogleMailAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleMailAccount_userId_key" ON "GoogleMailAccount"("userId");

ALTER TABLE "GoogleMailAccount" ADD CONSTRAINT "GoogleMailAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
