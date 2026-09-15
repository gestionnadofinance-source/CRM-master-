# CRM Master

Plateforme interne unique pour une holding possédant plusieurs CRM
indépendants. Une seule connexion, plusieurs espaces de travail
strictement isolés, collaboration en temps réel.

CRM préconfigurés : **Fidem Froid Clim**, **Fidem Maintenance**,
**Fitness Park Modge**, **Association**, **Société de Communication** —
renommables depuis l'administration, et un administrateur peut en ajouter
d'autres sans écrire de code (voir [Architecture multi-CRM](#architecture-multi-crm)).

## Sommaire

- [Architecture](#architecture)
- [Architecture multi-CRM](#architecture-multi-crm)
- [Installation](#installation)
- [Variables d'environnement](#variables-denvironnement)
- [Base de données et migrations](#base-de-données-et-migrations)
- [Création du premier administrateur](#création-du-premier-administrateur)
- [Authentification et sécurité](#authentification-et-sécurité)
- [Rôles et permissions](#rôles-et-permissions)
- [Isolation CRM — garanties et tests](#isolation-crm--garanties-et-tests)
- [Temps réel](#temps-réel)
- [Documents et stockage](#documents-et-stockage)
- [Emails](#emails)
- [Automatisations](#automatisations)
- [API pour intégrations externes](#api-pour-intégrations-externes)
- [Données de démonstration](#données-de-démonstration)
- [Données personnelles (RGPD)](#données-personnelles-rgpd)
- [Tests](#tests)
- [Déploiement](#déploiement)
- [Maintenance](#maintenance)
- [État du projet et limites connues](#état-du-projet-et-limites-connues)

## Architecture

- **Framework** : Next.js 15 (App Router) + TypeScript strict, React 19.
- **Base de données** : PostgreSQL + Prisma ORM (schéma unique multi-tenant,
  `prisma/schema.prisma`).
- **Authentification** : maison (bcrypt + sessions opaques stockées en base,
  révocables), voir [Authentification et sécurité](#authentification-et-sécurité).
- **Temps réel** : Pusher Channels (optionnel, avec repli automatique par
  rafraîchissement/sondage si non configuré).
- **PDF** : `@react-pdf/renderer` (rendu serveur, sans navigateur headless).
- **Stockage documents** : abstraction `StorageDriver` avec un pilote local
  (développement) et un pilote S3-compatible (production).
- **Emails** : SMTP via `nodemailer`.
- **UI** : Tailwind CSS, composants réutilisables sous `src/components/ui`.

### Organisation du code

```
prisma/                  schéma, migrations, scripts de seed
src/
  app/                   routes Next.js (App Router)
    (racine)             connexion, première connexion / changement de mot de passe
    home/                accueil CRM Master (sélection de CRM)
    settings/            paramètres personnels
    admin/                administration globale (utilisateurs, CRM, journal)
    c/[crmSlug]/          espace d'un CRM (dashboard, pipeline, clients...)
    book/[publicSlug]/    réservation publique (sans authentification)
    api/                  routes API (PDF, documents, cron, auth Pusher)
  server/                logique métier serveur ("use server"), organisée par domaine
    auth/                connexion, sessions, mots de passe
    tenant.ts            porte d'entrée unique de vérification d'accès CRM
    permissions.ts        rôles et permissions
    activity.ts           journal d'activité
    <domaine>/actions.ts  server actions par module (clients, quotes, ...)
  components/            composants UI réutilisables
  lib/                   utilitaires serveur/partagés (email, stockage, temps réel...)
tests/                    tests automatisés (Vitest)
```

### Principe directeur de l'isolation

> Toute table métier porte un `crmId`. Toute requête applicative doit
> passer par `requireCrmAccess` / `requireCrmAccessBySlug`
> (`src/server/tenant.ts`) avant de lire ou d'écrire une donnée. Un
> `crmId` transmis par le client n'est **jamais** fait confiance : il est
> systématiquement revalidé côté serveur contre les droits réels de
> l'utilisateur.

## Architecture multi-CRM

Chaque CRM est un espace fonctionnellement indépendant (clients, prospects,
pipeline, agenda, devis, tâches, messagerie, notifications, documents,
statistiques, automatisations, journal d'activité — voir la liste complète
dans `prisma/schema.prisma`).

**Ajouter un 6ᵉ CRM ne nécessite aucune modification de code.** Depuis
`/admin/crms`, un administrateur global crée un CRM ; le serveur exécute
`provisionCrm()` (`src/server/admin/provision-crm.ts`) qui, dans une seule
transaction, crée automatiquement :

- les informations de l'entreprise (`CompanySettings`) ;
- les paramètres de réservation publique (`BookingSettings`, avec un lien
  public unique) ;
- les 7 étapes de pipeline par défaut ;
- les 10 sources par défaut ;
- les 4 taux de TVA par défaut ;
- le compteur de numérotation des devis.

Le nouveau CRM bénéficie immédiatement de tous les modules (utilisateurs,
permissions, clients, prospects, agenda, devis, documents, messagerie,
notifications, statistiques, automatisations, journal d'activité) sans
duplication manuelle.

## Installation

Prérequis : Node.js ≥ 20, PostgreSQL ≥ 14.

```bash
npm install
cp .env.example .env
# renseigner DATABASE_URL au minimum — voir la section suivante

npx prisma migrate deploy   # applique les migrations existantes
npm run seed                 # crée les 5 CRM + le premier administrateur

npm run dev                  # http://localhost:3000
```

## Variables d'environnement

Voir `.env.example` pour la liste complète et commentée. Résumé :

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | oui | Connexion PostgreSQL |
| `DIRECT_URL` | non | Connexion directe (non poolée) utilisée par Prisma Migrate. Facultative si une intégration gérée expose déjà cette connexion (`DATABASE_URL_UNPOOLED` chez Neon, `POSTGRES_URL_NON_POOLING` chez Vercel Postgres/Supabase) : `scripts/vercel-migrate.sh` s'y replie, puis sur `DATABASE_URL` |
| `APP_URL` | recommandé | URL publique (emails, lien de réservation) |
| `SMTP_*` | non | Envoi réel des emails (bienvenue, feuilles de pointage). Sans configuration : emails journalisés côté serveur, l'application reste utilisable — les identifiants restent de toute façon gérés par un administrateur (voir Authentification et sécurité) |
| `PUSHER_*` / `NEXT_PUBLIC_PUSHER_*` | non | Temps réel. Sans configuration : repli automatique par rafraîchissement |
| `STORAGE_DRIVER`, `S3_*` | non (défaut `local`) | Stockage des documents. Utiliser `s3` en production sur un hébergeur sans disque persistant |
| `CRON_SECRET` | non | Protège la route d'automatisations planifiées `POST /api/public/cron/automations` |

Toutes les variables sont validées au démarrage par `src/lib/env.ts`
(échec explicite si une variable obligatoire est absente ou invalide —
jamais de valeur par défaut silencieuse pour un secret).

**Sécurité** : aucun secret serveur (`DATABASE_URL`,
`SMTP_*`, `PUSHER_SECRET`, `S3_SECRET_ACCESS_KEY`...) n'est jamais exposé
au navigateur. Seules les variables explicitement préfixées
`NEXT_PUBLIC_` (identifiants publics Pusher) atteignent le bundle client —
voir `src/lib/public-env.ts`, volontairement séparé de `src/lib/env.ts`.

## Base de données et migrations

```bash
npm run prisma:migrate    # développement : crée + applique une migration
npm run prisma:deploy     # production : applique les migrations existantes
npm run prisma:studio     # explorateur de données
```

Le schéma (`prisma/schema.prisma`) définit ~60 modèles. Toute table
métier (clients, prospects, rendez-vous, tâches, devis, documents,
messages, notifications, journal d'activité, configuration...) porte un
`crmId` avec un index dédié. Les contraintes d'unicité composites
(ex. `Quote.number` unique par `crmId`, `Source.name` unique par `crmId`)
empêchent les collisions entre CRM au niveau base de données, en
complément — jamais en remplacement — du contrôle applicatif.

## Création du premier administrateur

```bash
npm run seed
```

Crée les 5 CRM initiaux (préconfigurés : pipeline, sources, taux de TVA,
réservation) et un administrateur global. Variables optionnelles :
`ADMIN_EMAIL`, `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME`, `ADMIN_PASSWORD`
(valeurs par défaut : `admin@crm-master.local` / `ChangeMoi123!`).

Le mot de passe fourni est **temporaire** : `mustChangePassword` est à
`true`, l'administrateur doit obligatoirement en choisir un nouveau à la
première connexion (`/first-login`) avant d'accéder au reste de
l'application — y compris pour cet administrateur bootstrap.

Des administrateurs supplémentaires se créent ensuite depuis
`/admin/users` (voir [Rôles et permissions](#rôles-et-permissions)).

## Authentification et sécurité

- **Connexion** : email + mot de passe (bcrypt, 12 rounds). Pas de double
  authentification : les identifiants sont entièrement gérés par un
  administrateur (voir ci-dessous), ce qui remplace le besoin d'un second
  facteur par email pour ce produit à usage interne.
- **Sessions** : jetons opaques (aléatoires, hashés en base — jamais de
  JWT ni de secret en clair côté client), révocables individuellement
  (`/settings`, section « Sessions actives ») ou en masse (désactivation
  d'un compte, changement de mot de passe). Expiration configurable
  (`SESSION_TTL_HOURS`, 12h par défaut).
- **Identifiants gérés par l'administrateur** : un admin crée chaque
  compte avec un mot de passe temporaire ; l'utilisateur doit le
  remplacer avant tout accès (appliqué à la fois par le middleware et par
  `requireActiveAuth()` côté serveur — jamais uniquement par un masquage
  d'interface). Il n'y a pas de « mot de passe oublié » en self-service :
  depuis `/admin/users/[id]`, un administrateur peut à tout moment
  régénérer un mot de passe temporaire (affiché en clair, à communiquer
  lui-même) ou définir directement le mot de passe exact d'un utilisateur
  — les deux révoquent immédiatement toutes ses sessions actives.
- **Limitation des tentatives** : 5 échecs par compte / 20 par IP sur une
  fenêtre de 15 minutes.
- **Protection des routes** : garde légère au niveau du middleware
  (présence du cookie de session) doublée d'une vérification complète
  côté serveur sur chaque page/route/action (`requireAuth`,
  `requireActiveAuth`, `requireCrmAccess`) — le middleware seul n'est
  jamais considéré comme suffisant.
- **Mots de passe** : minimum 10 caractères, majuscule + minuscule +
  chiffre requis, validé côté serveur avec `zod` (jamais uniquement côté
  client).

## Rôles et permissions

- **Administrateur global** (`User.isGlobalAdmin`) : accès complet à
  l'administration et à tous les CRM. Plusieurs administrateurs globaux
  peuvent coexister.
- **Responsable CRM** / **Utilisateur** (`UserCrmAccess.role`, par CRM —
  un même utilisateur peut être responsable sur un CRM et simple
  utilisateur sur un autre).
- **Permissions détaillées** (`Permission` : `VIEW`, `CREATE`, `EDIT`,
  `DELETE`, `EXPORT`, `MANAGE_APPOINTMENTS`, `MANAGE_QUOTES`,
  `MANAGE_PROSPECTS`, `MANAGE_CLIENTS`, `MANAGE_SETTINGS`,
  `MANAGE_USERS`) : chaque rôle a un jeu de permissions par défaut
  (`src/server/permissions.ts`), et `UserCrmAccess.permissions` permet des
  dérogations additives fines (ex. accorder `EXPORT` à un simple
  utilisateur sans lui donner tout le rôle Responsable).
- **Catégorie d'accès** (`UserCrmAccess.category` : `COMMERCIAL` ou
  `OUVRIER`, indépendante du rôle) : un accès **Ouvrier** ne voit que les
  onglets **Planning** (chantiers annuels et affectations, gérés par les
  administrateurs/responsables) et **Coffre-fort** (documents personnels —
  fiches de paie, etc. — déposés par un administrateur, strictement
  isolés par utilisateur : personne d'autre, pas même un autre ouvrier,
  ne peut voir ou télécharger les documents d'un tiers). Un accès
  **Commercial** conserve tous les onglets existants, plus Planning et
  Coffre-fort. Cette restriction est appliquée à la fois côté navigation
  (`src/lib/nav.ts`) et côté serveur — un accès direct par URL à une page
  commerciale est redirigé (`src/app/c/[crmSlug]/layout.tsx`), et un
  accès `OUVRIER` n'hérite par défaut d'aucune permission commerciale
  (`effectivePermissions`, `src/server/permissions.ts`), ce qui protège
  automatiquement toutes les routes commerciales existantes sans avoir à
  les modifier une par une.

Un utilisateur peut avoir accès à plusieurs CRM et change d'espace sans
se reconnecter via le sélecteur de CRM (barre supérieure) : toutes les
données affichées (clients, prospects, agenda, devis, messagerie, tâches,
notifications, statistiques) changent intégralement, sans résidu du CRM
précédent.

## Isolation CRM — garanties et tests

Trois niveaux de protection, jamais un seul :

1. **Schéma** : `crmId` sur chaque table métier, index et contraintes
   d'unicité composites par CRM.
2. **Application** : `requireCrmAccess(ctx, crmId, permission?)` est le
   point de passage obligé de toute route/action serveur ; chaque entité
   chargée par id est en plus revérifiée explicitement avec
   `assertBelongsToCrm()` avant d'être utilisée — jamais de confiance
   dans un simple filtre `where: { id, crmId }`.
3. **Temps réel** : les canaux Pusher sont préfixés par CRM
   (`private-crm-{id}`) et leur autorisation (`/api/pusher/auth`) revérifie
   l'accès réel de l'utilisateur.

`tests/isolation.test.ts` exécute des tests d'intégration contre une base
PostgreSQL réelle démontrant explicitement qu'un utilisateur du CRM A ne
peut ni lire ni écrire les clients, prospects, rendez-vous, devis,
documents, messages ou notifications du CRM B — y compris en devinant un
identifiant directement (contournement d'URL/API) — et qu'un
administrateur global, bien qu'ayant accès à tous les CRM, ne reçoit
jamais de données mélangées entre CRM sur une requête scoped à un seul.

## Temps réel

Architecture par canaux Pusher scoped CRM (`src/lib/realtime.ts`,
`src/hooks/use-realtime-channel.ts`). Sans `PUSHER_*` configuré,
l'application reste entièrement fonctionnelle : chaque module associe un
repli (revalidation Next.js après mutation, sondage périodique pour la
messagerie/notifications) pour rester correct sans dépendance externe.

## Documents et stockage

Chaque document est associé à un `crmId`, un objet métier
(client/prospect/devis/rendez-vous/message) et un auteur. Le
téléchargement (`/api/documents/[id]`) revérifie systématiquement
l'appartenance au CRM, et — spécifiquement pour les pièces jointes de
messagerie — l'appartenance au fil de discussion (un membre du CRM ne
peut pas récupérer la pièce jointe d'une conversation privée à laquelle
il n'appartient pas). Types de fichiers et taille limités
(`src/lib/storage.ts`).

## Emails

`nodemailer` sur SMTP standard. N'intervient jamais dans l'authentification
(identifiants entièrement gérés par un administrateur, voir
[Authentification et sécurité](#authentification-et-sécurité)) : sert
uniquement à l'email de bienvenue optionnel et aux feuilles de pointage
envoyées par un chef de chantier. Sans configuration, ces emails sont
journalisés côté serveur au lieu d'échouer silencieusement.

## Automatisations

Moteur de règles par CRM (`src/server/automations/engine.ts`) :
déclencheurs (devis envoyé, rendez-vous terminé, prospect converti,
client créé, absence d'activité) → création de tâche de suivi, avec délai
configurable. Configurable depuis `/c/[crmSlug]/settings`.

La détection « absence d'activité depuis X jours » repose sur un
déclenchement périodique (aucun exécuteur de tâches planifiées n'est
disponible dans une application Next.js standard), assuré en production
par une entrée Vercel Cron (`vercel.json`, quotidienne à 6h UTC) :

- endpoint : `/api/public/cron/automations`, protégé par
  `Authorization: Bearer $CRON_SECRET` (GET, format ajouté
  automatiquement par Vercel Cron dès que la variable d'environnement
  `CRON_SECRET` existe sur le projet) ou par l'en-tête `x-cron-secret`
  (POST, déclenchement manuel) — 401 si le secret est absent ou
  incorrect ;
- la même exécution purge aussi les tentatives de connexion et les
  compteurs de limitation de fréquence devenus obsolètes (voir
  [Données personnelles (RGPD)](#données-personnelles-rgpd)).

## API pour intégrations externes

Pour brancher un outil externe (ex. Obsidian) sur les données de tous les
CRM via une clé API, sous `/api/public/v1` :

- **Émission des clés** : `/admin/api-keys` (réservé aux administrateurs
  globaux). La valeur en clair n'est affichée qu'une seule fois, à la
  création — seul son hash SHA-256 est conservé en base (même schéma que
  `Session.tokenHash`, voir `src/lib/crypto.ts`) ; une clé perdue ne peut
  être récupérée, uniquement révoquée puis remplacée.
- **Authentification** : en-tête `Authorization: Bearer <clé>` sur chaque
  requête. Réponse `401` si la clé est absente, inconnue ou révoquée.
- **Permission** (choisie une fois pour toutes à la création, jamais
  modifiable — une clé plus permissive = une nouvelle clé) :
  - `READ_ONLY` : seules les routes `GET` sont accessibles ;
  - `READ_WRITE` : `GET` + `POST`/`PATCH`/`DELETE`. Réponse `403` si une
    clé `READ_ONLY` appelle une route d'écriture.
- **Portée** : toutes les données de tous les CRM, équivalent à un
  administrateur global. Les routes d'écriture réutilisent tel quel le
  cœur métier des server actions de l'application (mêmes validations,
  mêmes effets de bord : notifications, journal d'activité, mouvements de
  pipeline, numérotation des devis...) — voir le paramètre optionnel
  `actorCtx` de `createClient`, `saveQuote`, etc. et
  `src/server/public-api/auth.ts` (`requireWriteAccess`).
- **Pagination** (routes de liste) : paramètres `page` et `perPage`
  (défaut 100, plafonné à 500) ; réponse `{ data, page, perPage, total }`.
- **Endpoints en lecture** (`GET /api/public/v1/...`) :
  - `crms` — liste des CRM actifs
  - `clients`, `prospects` — fiches commerciales
  - `quotes` — devis
  - `tasks` — tâches
  - `appointments` — rendez-vous d'agenda
  - `chantiers` — chantiers et affectations (planning)
  - `pointages` — feuilles de pointage (heures saisies, hors taux/primes
    en euros)
  - `crms/:id/members` — utilisateurs ayant accès à ce CRM (`id`, `name`,
    `category`), pour retrouver l'`ownerId`/`assigneeId` à passer aux
    endpoints d'écriture (aucune fiche client/tâche n'expose cet id
    directement, seulement un `ownerName` d'affichage)
  - `crms/:id/vat-rates` — taux de TVA du CRM (`id`, `label`, `rate`,
    `isDefault`), pour le `vatRateId` de chaque ligne d'un devis créé via
    `POST /quotes`
- **Endpoints en écriture** (clé `READ_WRITE` requise) :
  - `POST /clients`, `/prospects`, `/tasks`, `/appointments`, `/chantiers`
    — création (corps JSON avec les champs du formulaire correspondant +
    `crmId` obligatoire) ;
  - `PATCH /clients/:id`, `/prospects/:id`, `/chantiers/:id` — mise à jour
    complète (mêmes champs que la création) ;
  - `PATCH /tasks/:id`, `/appointments/:id` — mise à jour complète, ou
    `{ crmId, status }` seul pour ne changer que le statut (ex. terminer
    une tâche) ;
  - `DELETE /clients/:id?crmId=...`, `/prospects/:id?crmId=...`,
    `/tasks/:id?crmId=...`, `/appointments/:id?crmId=...`,
    `/chantiers/:id?crmId=...` — suppression (`crmId` en paramètre de
    requête) ;
  - `POST /quotes` (création, brouillon) et `PATCH /quotes/:id` (édition
    tant que le devis est modifiable) — corps JSON `{ crmId, clientId ou
    prospectId, object, issueDate, validUntil, items: [...], ... }`, voir
    `saveQuote` ; `DELETE /quotes/:id?crmId=...` (brouillons uniquement) ;
    `POST /quotes/:id/status` avec `{ crmId, status }` pour les
    transitions (`FOLLOWED_UP`/`ACCEPTED`/`REFUSED`/`EXPIRED` — l'envoi,
    qui génère un PDF et un email, n'est pas exposé ici) ;
  - `POST /pointages` — création ou mise à jour (upsert par salarié +
    semaine, comme côté application) d'une fiche de pointage ; `DELETE
    /pointages/:id?crmId=...`.
- **Réponses d'erreur** : `{ error }` avec `400` (validation), `403`
  (permission insuffisante ou clé en lecture seule), `404` (CRM ou entité
  introuvable) ou `409` (doublon détecté, ex. SIRET déjà utilisé — le
  corps inclut alors `duplicate: { id, company }`).

Exemples :

```bash
# Lecture
curl -H "Authorization: Bearer cmk_..." \
  "https://crm-master-bice.vercel.app/api/public/v1/clients?page=1&perPage=100"

# Créer une tâche (clé READ_WRITE)
curl -X POST -H "Authorization: Bearer cmk_..." -H "Content-Type: application/json" \
  -d '{"crmId":"...","title":"Rappeler le client","assigneeId":"...","priority":"NORMAL","status":"TODO"}' \
  "https://crm-master-bice.vercel.app/api/public/v1/tasks"

# Terminer une tâche
curl -X PATCH -H "Authorization: Bearer cmk_..." -H "Content-Type: application/json" \
  -d '{"crmId":"...","status":"DONE"}' \
  "https://crm-master-bice.vercel.app/api/public/v1/tasks/<id>"
```

## Données de démonstration

```bash
npm run seed:demo        # génère des données de démonstration pour les 5 CRM
npm run seed:demo:clear  # les supprime intégralement
```

Toute donnée de démonstration est identifiable sans ambiguïté (préfixe
`[DEMO] ` sur les entreprises/objets, domaine `@demo.crm-master.local`
pour les comptes utilisateurs de démonstration, mot de passe
`DemoPass123!`) et strictement séparable des données réelles — `seed:demo`
est idempotent (ré-exécutable sans dupliquer), `seed:demo:clear` ne
touche jamais les 5 CRM réels ni le compte administrateur.

## Données personnelles (RGPD)

Aucun outil ne couvre aujourd'hui l'export ou l'anonymisation complète
des données personnelles d'un utilisateur, d'un client ou d'un prospect
en une seule action — jusqu'à ce que ce soit outillé, une demande
(article 15, portabilité, ou article 17, effacement) se traite
manuellement, table par table. Cette section sert de procédure et de
cartographie en attendant.

**Où se trouvent les données personnelles :**

| Table | Champs personnels | Remarque |
| --- | --- | --- |
| `User` | `firstName`, `lastName`, `email`, `avatarUrl`, `signatureText`, `signatureImageUrl` | Compte interne (salarié) |
| `Session` | `ipAddress`, `userAgent` | Purgée par cascade à la suppression du `User` |
| `LoginAttempt` | `email`, `ipAddress` | Purge automatique après 90 jours (route cron, voir [Automatisations](#automatisations)) |
| `RateLimitHit` | `identifier` (adresse IP) | Purge automatique après 7 jours |
| `Client`, `Prospect` | `firstName`, `lastName`, `phone`, `email`, `address`, `siret` | Personne physique de contact au sein d'une entreprise cliente/prospect |
| `ClientContact`, `ProspectContact` | `firstName`, `lastName`, `phone`, `email` | Contacts additionnels |
| `Appointment` | `bookingContactName`, `bookingContactEmail`, `bookingContactPhone`, `reportNotes` | Notamment via la réservation publique |
| `Message` | `body` (texte libre) | Peut contenir des données personnelles selon le contenu échangé |
| `Document`, `VaultDocument` | fichier lui-même | Le contenu du fichier peut porter des données personnelles (ex. fiche de paie) |
| `ActivityLog` | `oldValue`/`newValue` (JSON) | Peut contenir un instantané de champs personnels au moment de l'action |
| `Pointage` | lié à `employeeId`/`foremanId` | Données de temps de travail d'un salarié |

**Outils déjà disponibles :**

- **Désactiver un compte** (`/admin/users`) : conserve l'historique
  (intégrité référentielle), révoque immédiatement les sessions actives.
- **Purger le journal d'activité d'un utilisateur** (`/admin/users/[id]`,
  confirmation par ressaisie de l'email) : supprime les lignes
  `ActivityLog` de cet utilisateur.
- **Exporter les données personnelles d'un salarié** (`/admin/users/[id]`,
  carte « Données personnelles (RGPD) ») : télécharge un JSON couvrant tout
  ce qui, pour un `User`, est listé dans la cartographie ci-dessus (profil,
  accès CRM, sessions, tentatives de connexion, messages envoyés, journal
  d'activité, fiches de pointage en tant que salarié) — répond à une
  demande d'accès/portabilité (article 15) sans interroger les tables à la
  main.
- **Anonymiser un compte salarié** (même carte) : remplace
  `firstName`/`lastName`/`email`/avatar/signature par des valeurs anonymes
  et révoque les sessions actives, sans supprimer la ligne elle-même
  (l'intégrité référentielle des devis/messages/tâches qu'il a créés est
  préservée) — répond à une demande d'effacement (article 17). N'est
  disponible qu'une fois le compte désactivé, et jamais sur son propre
  compte.

Ces deux outils couvrent le cas `User` (salarié). `Client`/`Prospect`
suivent une procédure distincte, ci-dessous.

**Procédure manuelle pour une demande d'accès/portabilité (article 15) sur un `Client`/`Prospect` :**

1. Identifier l'entité (`id` ou `siret`).
2. Interroger chaque table de la cartographie ci-dessus filtrée sur cette
   entité (`clientId`/`prospectId` selon la table) via `npx prisma studio`
   ou une requête directe.
3. Exporter le résultat (JSON ou tableur) et le transmettre selon le
   canal habituel de traitement des demandes RGPD de l'organisation.

**Procédure manuelle pour une demande d'effacement (article 17) sur un `Client`/`Prospect` :**

1. Confirmer qu'aucune obligation légale de conservation ne s'applique
   (ex. facturation) avant toute suppression.
2. Les documents attachés doivent être supprimés via l'action de
   suppression de l'entité (déjà outillée, nettoie le stockage physique —
   voir [Documents et stockage](#documents-et-stockage)) avant toute
   anonymisation manuelle des champs restants.
3. Journaliser l'opération (qui, quand, pourquoi) en dehors de
   `ActivityLog` si celui-ci doit lui-même être couvert par la demande.

**Amélioration prévue, non développée à ce stade** : les mêmes actions
(export JSON, anonymisation) pour `Client`/`Prospect`, sur le même modèle
que celles déjà disponibles pour `User`.

## Tests

```bash
npm test          # suite complète (Vitest)
npm run typecheck # TypeScript strict
npm run lint      # ESLint
npm run build     # build de production (échoue si erreurs de type/lint)
```

La suite couvre notamment : hashage et validation des mots de passe,
invariants de validité de session (y compris la révocation lors d'un
changement de mot de passe par un administrateur), calcul des feuilles de
pointage, permissions par défaut et dérogations par rôle, et — le plus
important — l'isolation CRM de bout en bout (voir
[ci-dessus](#isolation-crm--garanties-et-tests)).
Chaque module métier a par ailleurs été validé manuellement de bout en
bout contre un serveur réel (connexion, création d'entités, génération de
PDF avec pagination, réservation publique, isolation cross-CRM sur les
routes authentifiées et publiques).

## Déploiement

L'application est un projet Next.js standard, déployable sur tout
hébergeur Node.js (Vercel, un serveur Node classique, un conteneur...).

Points d'attention spécifiques à un déploiement serverless (type Vercel) :

- **Stockage de fichiers** : utiliser `STORAGE_DRIVER=s3` (le disque local
  n'est pas persistant sur Vercel).
- **Temps réel** : configurer Pusher (`PUSHER_*`), une architecture
  WebSocket persistante n'étant pas disponible en serverless.
- **Automatisations planifiées** : configurer un déclencheur cron externe
  vers `/api/public/cron/automations` (voir [Automatisations](#automatisations)).
- **Base de données** : PostgreSQL managé (Neon, Supabase, RDS...),
  `DATABASE_URL` pointant vers celui-ci ; exécuter `prisma migrate deploy`
  au déploiement (jamais `migrate dev` en production).

Étapes générales :

```bash
npm run prisma:deploy   # applique les migrations
npm run seed             # première installation uniquement
npm run build
npm start                 # ou déploiement sur la plateforme cible
```

## Maintenance

- **Ajouter un CRM** : `/admin/crms` → « Ajouter un CRM » (aucune
  intervention technique nécessaire, voir [Architecture multi-CRM](#architecture-multi-crm)).
- **Désactiver un utilisateur** : `/admin/users` → conserve son
  historique ; ses sessions actives sont immédiatement révoquées.
- **Purger l'historique d'un utilisateur** : fonction dédiée dans
  `/admin/users/[id]` (confirmation forte requise — saisie de l'email
  exact) ; supprime uniquement le journal d'activité de l'utilisateur,
  jamais son compte ni les données métier qu'il a créées.
- **Migrations** : toujours créer une migration nommée
  (`npx prisma migrate dev --name ...`) plutôt que modifier une migration
  existante ; ne jamais éditer `prisma/schema.prisma` sans migration
  correspondante.
- **Journal d'activité** : consultable par CRM (`/c/[crmSlug]/activity`,
  accessible à tout membre du CRM) et globalement
  (`/admin/activity`, réservé aux administrateurs globaux).

## État du projet et limites connues

Application fonctionnelle de bout en bout (build de production propre,
suite de tests automatisés passante, parcours complet validé manuellement :
connexion, première connexion, création d'utilisateurs et
d'accès CRM, clients/prospects/pipeline, agenda et réservation publique,
devis avec génération PDF paginée, tâches, messagerie isolée par CRM,
administration globale et par CRM). Points identifiés pour une suite de
développement :

- L'édition d'un modèle de devis existant (`QuoteTemplate`) n'est pas
  encore disponible depuis `/c/[crmSlug]/settings` (seules la création et
  la suppression le sont).
- La propagation temps réel du renommage d'un CRM s'appuie sur la
  revalidation Next.js (effective à la prochaine navigation) plutôt que
  sur un canal Pusher dédié — comportement volontaire, documenté dans le
  code (`src/server/admin/actions.ts`).
- Les objectifs commerciaux (`CommercialObjective`) et les statistiques
  de prévision commerciale avancées existent dans le schéma de données
  mais n'ont pas d'interface dédiée.
- L'export et l'anonymisation des données personnelles sont outillés pour
  un `User` (salarié) depuis `/admin/users/[id]`, mais pas encore pour un
  `Client`/`Prospect` — voir
  [Données personnelles (RGPD)](#données-personnelles-rgpd) pour la
  procédure manuelle en attendant sur ce second cas.
- **Dépendances avec advisories de sécurité non corrigées** :
  `npm audit` signale 6 vulnérabilités "high" sur `postcss`/`sharp`
  (embarquées par `next`) et `deepmerge-ts` (embarqué par
  `@prisma/config`, CLI Prisma uniquement). Aucun correctif non cassant
  n'existe à ce jour (`npm audit fix` sans `--force` ne change rien) : la
  seule résolution est une montée de version majeure de Next.js
  (actuellement 15.5.23, la plus récente de la branche 15.x → 16.x).
  Risque accepté pour l'instant — `sharp` n'est utilisé nulle part dans
  `src/` (pas de pipeline `next/image` sur des images envoyées par un
  utilisateur) et PostCSS ne traite que du CSS de build, donc
  l'exploitabilité pratique est jugée faible dans l'usage actuel de
  l'application. À revoir lors de la prochaine montée de version majeure
  planifiée de Next.js.
- **Preview et Production partagent actuellement la même base Neon**
  (vérifié directement en comparant l'hôte de connexion résolu par
  `DATABASE_URL` dans chaque environnement Vercel : identique dans les
  deux cas). Toute build Preview (déclenchée par une simple ouverture de
  PR) lit et écrit donc dans les données réelles — aucune isolation
  n'existe aujourd'hui entre les deux. Correction nécessitant un accès au
  tableau de bord Neon (hors du périmètre de ce dépôt de code) :
  1. créer une branche Neon dédiée (ex. `preview`), issue de la branche
     de production ;
  2. dans Vercel → Project Settings → Environment Variables, remplacer
     `DATABASE_URL`/`DIRECT_URL` pour l'environnement **Preview**
     uniquement par la chaîne de connexion de cette nouvelle branche
     Neon (laisser **Production** inchangé) ;
  3. redéployer une Preview et vérifier qu'elle ne modifie plus les
     données de production.
