#!/bin/sh
# Applique les migrations Prisma avec plusieurs tentatives.
#
# Sur les fournisseurs Postgres "scale-to-zero" (ex. Neon en offre
# gratuite), le compute peut être suspendu entre deux déploiements. La
# première tentative de connexion le réveille mais peut dépasser le délai
# fixe de 10s que Prisma Migrate s'accorde pour acquérir son verrou
# consultatif (P1002) — sans que ce délai soit configurable. Les tentatives
# suivantes, une fois le compute réveillé, aboutissent normalement.
set -e

attempts=4
delay=5

for i in $(seq 1 "$attempts"); do
  if npx prisma migrate deploy; then
    exit 0
  fi
  echo "prisma migrate deploy a échoué (tentative $i/$attempts), nouvel essai dans ${delay}s..."
  sleep "$delay"
  delay=$((delay * 2))
done

echo "prisma migrate deploy a échoué après $attempts tentatives."
exit 1
