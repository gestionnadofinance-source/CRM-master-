# Application installable (PWA) — mode d'emploi

CRM Master s'installe comme une application sur ordinateur, téléphone et
tablette, **depuis son adresse habituelle**, sans App Store ni Google Play et
sans service payant. Le site reste utilisable dans le navigateur comme avant :
l'application installée n'est qu'une fenêtre dédiée sur le même site, avec le
même compte et les mêmes données.

---

## Pour les utilisateurs : installer CRM Master

Le bouton **« Télécharger l'application »** se trouve dans le menu du compte
(l'avatar, en haut à droite), sur toutes les pages. À la première visite, un
petit bandeau le propose aussi ; « Plus tard » le masque pour 30 jours, le
bouton du menu reste toujours là.

| Appareil | Ce qui se passe au clic |
|---|---|
| **Windows / Mac — Chrome ou Edge** | La fenêtre d'installation du navigateur s'ouvre. Cliquez sur « Installer ». CRM Master apparaît dans le menu Démarrer / le Launchpad, et s'ouvre dans sa propre fenêtre. |
| **Mac — Safari (macOS 14 et plus)** | Instructions : menu **Fichier → Ajouter au Dock…**. |
| **Android — Chrome** | La fenêtre d'installation s'ouvre. Touchez « Installer » : l'icône apparaît sur l'écran d'accueil et dans les applications. |
| **Android — Samsung Internet, Firefox** | Instructions propres au navigateur (menu → ajouter à l'écran d'accueil). |
| **iPhone / iPad — Safari** | Instructions : bouton **Partager** (sur iOS 26 : menu « ••• » puis Partager) → **Sur l'écran d'accueil** → **Ajouter**. Apple ne permet pas à un site de lancer lui-même l'installation. |
| **iPhone / iPad — Chrome, Edge (iOS 16.4 et plus)** | Même procédure par le menu de partage du navigateur. |
| **Application intégrée (lien ouvert depuis Gmail, WhatsApp, Instagram…)** | Explique comment ouvrir la page dans Safari ou Chrome d'abord. |
| **Firefox sur ordinateur** | Firefox n'installe pas d'application web : utilisez Chrome ou Edge (le CRM reste utilisable dans Firefox). |

Une fois installée, l'entrée du menu devient **« Application installée »**.

### Vérifier que l'installation fonctionne

1. Fermez le navigateur.
2. Lancez **CRM Master** depuis l'écran d'accueil, le bureau ou le menu des
   applications : il s'ouvre dans sa propre fenêtre, sans barre d'adresse.
3. Connectez-vous si besoin : c'est la connexion habituelle.
4. Dans le menu du compte, l'entrée indique « Application installée ».

### Désinstaller

- Chrome / Edge (ordinateur) : dans l'application, menu « ⋮ » → *Désinstaller
  CRM Master*.
- Android : appui long sur l'icône → *Désinstaller* (ou *Supprimer*).
- iPhone / iPad : appui long sur l'icône → *Supprimer l'app*.
- Mac (Safari) : supprimer CRM Master du dossier Applications.

---

## Mises à jour

Rien à faire côté utilisateurs : à chaque déploiement sur Vercel, l'application
installée détecte la nouvelle version et affiche **« Une nouvelle version de
CRM Master est disponible — Recharger »**. Le rechargement n'est **jamais**
imposé, pour ne pas perdre une saisie en cours. Les pages et les données
viennent toujours du serveur : même sans cliquer, personne ne travaille sur des
données périmées.

---

## Hors connexion

CRM Master reste une application connectée. Sans réseau :
- une page déjà ouverte affiche **« Hors connexion »** : ce qui est à l'écran
  peut ne plus être à jour, et rien ne peut être enregistré ;
- une nouvelle page affiche « Pas de connexion internet » avec un bouton
  « Réessayer ». **Aucune donnée n'est conservée sur l'appareil.**

---

## Architecture (pour la maintenance)

| Fichier | Rôle |
|---|---|
| `src/app/manifest.ts` | Manifeste servi à `/manifest.webmanifest` (nom, couleurs `#254DEA` / `#FAFAFB`, icônes, `start_url: /home`, `scope: /`, `display: standalone`). |
| `public/icons/*.png` | Icônes 192 / 512 (normales et *maskable*), icône Apple 180, favicon 32 — tirées du logo « CM » existant. |
| `src/app/layout.tsx` | Métadonnées : icônes, réglages Apple (`apple-mobile-web-app-*`), couleur de thème. |
| `src/app/sw.js/route.ts` | Service worker servi à `/sw.js`, figé à chaque construction (sa version change à chaque déploiement). |
| `public/offline.html` | Page « Pas de connexion internet », sans aucune donnée. |
| `src/components/pwa/pwa-early-script.tsx` | Capture l'invite d'installation de Chrome/Edge dès le chargement, sans l'afficher. |
| `src/components/pwa/install-store.ts` | État d'installation (invite disponible, mode installé, bandeau fermé). |
| `src/components/pwa/install-center.tsx` | Entrée du menu, bandeau, fenêtre d'aide, messages de résultat. |
| `src/components/pwa/pwa-provider.tsx` | Enregistrement du service worker, message de nouvelle version, indicateur hors connexion. |
| `src/lib/pwa/platform.ts` | Détection appareil / navigateur et instructions d'installation. |
| `src/proxy.ts` | Laisse lire **sans session** uniquement : manifeste, `/sw.js`, `/offline.html`, `/icons/*.png`. |

### Ce que le service worker garde, et ce qu'il ne touche pas

- **Gardé** (cache par version, supprimé à la version suivante) : les fichiers
  statiques publics et versionnés de `/_next/static/`, les icônes, la page
  hors connexion. Identiques pour tous les utilisateurs, sans donnée.
- **Jamais gardé** : les pages (toujours chargées depuis le serveur), les API,
  les actions serveur (enregistrements), les données de page, les documents du
  coffre-fort, la session. Ces requêtes ne sont même pas interceptées.

### Sécurité

- L'installation ne contourne aucun contrôle : l'application installée envoie
  les mêmes requêtes, avec le même cookie de session, que le navigateur.
- Aucune route privée n'a été rendue publique : la liste du middleware est
  fermée (chemins exacts + `/icons/<nom>.png`), testée dans `tests/pwa.test.ts`.
- Après déconnexion, aucune page privée n'est servie depuis un cache.
- À surveiller : ne jamais ajouter au service worker une mise en cache de
  pages, d'API ou de `/api/vault/*` ; ne jamais élargir la liste publique du
  middleware à un préfixe de route.

### Hébergement

Rien à configurer : Vercel sert déjà le site en **HTTPS** (indispensable à
l'installation et au service worker). L'application est hébergée à la racine
du domaine (`scope: /`). Utilisez toujours l'adresse de production
(`crm-master-olive.vercel.app`) : une application installée depuis l'adresse
d'un déploiement particulier resterait liée à ce déploiement.

### Tests

- `tests/pwa.test.ts` : middleware, manifeste et icônes, logique du service
  worker (exécutée dans un environnement simulé), instructions par appareil.
- `scripts/qa/pwa-e2e.ts` : validation dans Chromium contre un serveur de
  production local — installabilité (Chrome DevTools Protocol), contenu réel
  du cache après navigation authentifiée, hors connexion, bouton d'installation
  (invite native simulée, iPhone, mode installé), connexion / déconnexion,
  affichage mobile 390 px, mise à jour entre deux constructions.
- **Non testable ici** : l'installation réelle sur un appareil Windows, Mac,
  Android, iPhone ou iPad. À vérifier une fois à la main (voir plus haut).
