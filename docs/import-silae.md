# Import Silae — mode d'emploi

Cette page remplace la ressaisie manuelle du classeur Excel dans mySilae.
L'export Excel reste disponible dans **Comptabilité** : rien n'a été retiré.

---

## Une fois pour toutes, avant le premier export

### 1. Renseigner les matricules Silae

`Administration > Utilisateurs > [le salarié]`, bloc de l'espace concerné,
champ **Matricule Silae**.

Le matricule est propre à **chaque espace** : un salarié présent dans Fidem
Froid Clim et Fidem Maintenance relève de deux dossiers Silae, donc de deux
matricules. Saisissez-le exactement comme dans Silae, **zéros de tête
compris** (`00012`, pas `12`).

Un salarié sans matricule bloque la génération du fichier — le rapport le dit
nommément.

### 2. Vérifier les codes Silae

`Import Silae > Codes Silae`.

> **Le point le plus important de toute la procédure.** Silae n'émet
> **aucune erreur** sur un code inconnu : la ligne est ignorée, sans message,
> et la valeur n'arrive jamais sur le bulletin. Un code faux est donc
> invisible tant qu'on ne compare pas les montants.

Relevez les codes exacts dans Silae : `Paramétrage > Variables à saisir`.
Recopiez-les **à l'identique**, majuscules et minuscules comprises, avec leur
préfixe (`EV-` pour les éléments variables, `HS25`/`HS50` pour les heures
supplémentaires).

Pour chaque rubrique :

- **Code Silae** — l'intitulé exact de la colonne dans Silae.
- **Multiplicateur** — 1 par défaut. À changer seulement si Silae attend un
  montant là où le CRM compte des unités (par exemple 20 pour envoyer
  20 € par repas au lieu du nombre de repas).
- **Exporter** — décochez pour laisser une rubrique de côté.

Trois rubriques arrivent **sans code**, faute d'équivalent connu : prime de
salissure, remboursement du temps de trajet, et grand déplacement à 80 €.
Demandez-les à votre gestionnaire de paie. Tant qu'elles sont vides, le
rapport les signale et elles ne partent pas.

---

## Chaque mois

### 1. Saisir ce qui ne vient pas des pointages

- **Acomptes** : onglet *Acomptes*. Montant, date de versement, et surtout le
  **mois de paie** auquel l'imputer — ce n'est pas toujours le mois du
  versement.
- **Absences et congés** : onglet *Absences*. La saisie existe et remplace
  les notes libres ; leur **export n'est pas encore branché**, le format de
  fichier Silae devant être récupéré auprès du gestionnaire de paie.

### 2. Vérifier

`Import Silae > Export`, choisissez le mois, puis **Vérifier**.

Lisez le rapport dans cet ordre :

1. **À corriger avant de générer** (rouge) — bloque le téléchargement.
   Aujourd'hui, un seul cas : un salarié sans matricule.
2. **À vérifier** (orange) — laisse passer, mais mérite un coup d'œil :
   rubrique sans code, semaine à plus de 60 h, valeur négative.
3. **Ne passe pas par cet import** (gris) — rappels de ce qui reste à faire
   à la main dans Silae.
4. **Le détail par salarié** — chaque rubrique avec sa valeur CRM et la
   valeur réellement exportée. C'est ce tableau qu'on compare à l'ancien
   classeur Excel pendant la période de test.

### 3. Télécharger

**Télécharger le CSV**. Le fichier est nommé
`IMPORT_SILAE_<espace>_<AAAA-MM>.csv`.

L'encodage **Windows-1252 (ANSI)** est le bon dans la quasi-totalité des cas.
Si les accents apparaissent en `Ã©` dans Silae, essayez UTF-8 — et l'inverse.

### 4. Importer dans Silae

`Traitement Mois > Import de données variables > import standard
« importsilae »`.

---

## La toute première fois : procédez par étapes

1. **Comparez** l'export de test avec les lignes TOTAL du classeur Excel du
   même mois, salarié par salarié.
   Deux écarts sont **attendus et normaux** :
   - les sous-totaux tapés en dur dans l'Excel (par exemple 39 h sur une
     semaine sans une seule heure saisie) — le CSV, lui, recalcule toujours
     depuis les pointages journaliers ;
   - le `×1,25` que l'Excel appliquait aux heures supplémentaires — Silae
     attend un **nombre d'heures** et applique lui-même la majoration.
2. **Testez sur un seul salarié** : ouvrez le CSV dans un éditeur de texte,
   ne gardez que la ligne d'en-tête et 2 ou 3 lignes, importez, et vérifiez
   que chaque valeur arrive dans la bonne colonne des éléments variables.
3. **Puis seulement** importez le fichier complet.

---

## Ce que le CRM ne sait pas encore faire

| | |
|---|---|
| Heures fériées **chômées** | Non calculées : le CRM ne connaît pas l'horaire contractuel non travaillé. À saisir à la main. |
| Absences et congés | Saisis dans le CRM, pas encore exportés (format de fichier à obtenir). |
| Saisies sur salaire, RIB, adresse | Ne passent pas par cet import, par conception. À traiter dans Silae. |
| Signe de la retenue de chambre | Exportée en positif. À confirmer avec le gestionnaire selon le paramétrage de la rubrique dans Silae. |

---

## D'où viennent les chiffres

- **Tout est recalculé depuis les pointages journaliers.** Aucun total saisi
  ailleurs n'est lu — c'était le défaut du classeur Excel.
- **Heures supplémentaires** : calculées par semaine. Au-delà de 35 h, les
  8 premières heures en 25 %, le reste en 50 %.
- **Jours fériés** : calendrier français calculé automatiquement, fêtes
  mobiles comprises. France métropolitaine uniquement.
- **Semaine à cheval sur deux mois** : les heures, repas et kilomètres sont
  répartis **jour par jour**. Les primes forfaitaires de la semaine et les
  heures supplémentaires vont **en entier** au mois qui porte le plus de
  jours travaillés de cette semaine.
- **Frais SNCF et retenue de chambre** : rattachés à l'affectation sur un
  chantier, donc comptés **une seule fois par mois** et non par semaine.
