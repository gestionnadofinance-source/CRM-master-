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

# Prisma Migrate exige une connexion DIRECTE (non poolée) via DIRECT_URL :
# les poolers en mode transaction (PgBouncer, pooler Neon) ne supportent pas
# les verrous consultatifs qu'il utilise pour éviter les migrations
# concurrentes. Voir prisma/schema.prisma (datasource db).
#
# DIRECT_URL reste le nom de référence, neutre vis-à-vis de l'hébergeur (voir
# .env.example). Mais les intégrations gérées exposent cette même connexion
# directe sous leur propre nom et ne peuvent pas deviner le nôtre : sans ce
# repli, il faut créer DIRECT_URL à la main dans le tableau de bord, et
# l'oublier fait échouer tout le déploiement sur un P1012.
if [ -z "$DIRECT_URL" ]; then
  if [ -n "$DATABASE_URL_UNPOOLED" ]; then
    # Intégration Neon (Vercel Marketplace).
    echo "DIRECT_URL absente : repli sur DATABASE_URL_UNPOOLED."
    DIRECT_URL="$DATABASE_URL_UNPOOLED"
  elif [ -n "$POSTGRES_URL_NON_POOLING" ]; then
    # Intégration Vercel Postgres / Supabase.
    echo "DIRECT_URL absente : repli sur POSTGRES_URL_NON_POOLING."
    DIRECT_URL="$POSTGRES_URL_NON_POOLING"
  elif [ -n "$DATABASE_URL" ]; then
    # Dernier recours : DATABASE_URL. Correct chez un hébergeur sans pooler
    # (la connexion y est déjà directe) ; avec un pooler en mode transaction,
    # la migration échouera en P1002 et il faudra alors définir DIRECT_URL
    # explicitement.
    echo "DIRECT_URL absente : repli sur DATABASE_URL."
    DIRECT_URL="$DATABASE_URL"
  fi

  # Si aucune de ces variables n'est présente dans l'environnement — cas du
  # développement local, où Prisma lit lui-même le fichier .env — ne rien
  # exporter : une DIRECT_URL vide masquerait la valeur du .env et provoquerait
  # justement le P1012 que ce repli cherche à éviter.
  if [ -n "$DIRECT_URL" ]; then
    export DIRECT_URL
  fi
fi

attempts=4
delay=5

for i in $(seq 1 "$attempts"); do
  if output=$(npx prisma migrate deploy 2>&1); then
    printf '%s\n' "$output"
    exit 0
  fi
  printf '%s\n' "$output"

  # P1012 = erreur de validation du schéma ou de la configuration (variable
  # d'environnement manquante, schéma invalide). Contrairement à P1002, aucune
  # nouvelle tentative ne la résoudra : échouer tout de suite plutôt que de
  # rallonger le build de 75s pour rien.
  if printf '%s' "$output" | grep -q 'P1012'; then
    echo "Erreur de configuration (P1012) : nouvel essai inutile, arrêt immédiat."
    exit 1
  fi

  if [ "$i" -lt "$attempts" ]; then
    echo "prisma migrate deploy a échoué (tentative $i/$attempts), nouvel essai dans ${delay}s..."
    sleep "$delay"
    delay=$((delay * 2))
  fi
done

echo "prisma migrate deploy a échoué après $attempts tentatives."
exit 1
