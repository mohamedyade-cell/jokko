# Import : format attendu et modèle de données

## 1. Principes

L'import est lancé depuis l'écran **Imports** (Responsable) ou par `scripts/importer.py`.
Il est **idempotent** : relancé avec les mêmes fichiers, il ne crée aucune ligne.

| Règle | Mise en œuvre |
|---|---|
| Ne jamais recréer un ID existant | L'application ne génère jamais d'ID ; elle reprend ceux de l'onglet Base (format `ENT-\d{5,}`). Une ligne d'ID invalide ou dupliqué est rejetée et signalée. |
| Ne jamais perdre un ID | Une entreprise absente d'une nouvelle version est conservée, marquée « absente du dernier import » et listée dans le rapport. Aucune suppression. |
| Appliquer `entity_alias` | Les alias du moteur (ancien → nouvel ID, chaînes suivies, cycles détectés) sont appliqués : (1) aux saisies du classeur (Call Tracker, Qualification, Pipeline, Corrections, Doublons) ; (2) aux saisies déjà présentes dans l'application, en fusionnant l'ancienne entreprise dans la nouvelle (statut « Fusionnée », saisies rattachées, rien supprimé). |
| Ne jamais écraser une saisie utilisateur | Tout champ corrigé dans l'application, toute attribution, toute vague manuelle est « verrouillé » et n'est plus modifié par un import. Une qualification déjà présente n'est jamais remplacée. Les paramètres, segments et tailles modifiés dans l'application sont conservés. |
| Saisies du classeur sans doublon | Chaque ligne Call Tracker / Pipeline / Corrections reçoit une clé d'empreinte ; une ligne déjà importée est ignorée. |
| Rapport | Nouvelles entreprises, ID fusionnés, absentes, saisies importées / ignorées / rejetées, valeurs protégées, colonnes non reconnues, anomalies (ID invalides, RCCM/NAEMA suspects, commerciaux inconnus, étapes inconnues…), écarts de score / catégorie / vague avec le classeur. |
| Simulation | Option « Simulation » : le rapport est calculé puis tout est annulé. |
| Fictif / réel | Un classeur déclarant `Jeu de données = FICTIF` (onglet Paramètres) marque ses entreprises fictives ; l'import refuse de mélanger fictif et réel dans une même base. |

Chaque import est tracé (table `imports` + entrée `IMPORT` du journal d'audit) ; chaque entreprise
créée ou modifiée l'est aussi ligne par ligne.

## 2. Classeur `SUNU_FX_SALES_RADAR.xlsx`

Le classeur est lu en **valeurs** (résultats des formules), jamais modifié. Les en-têtes sont
reconnus sans tenir compte des accents, majuscules et ponctuation ; la ligne d'en-tête est
détectée automatiquement dans les 15 premières lignes. Les alias reconnus figurent dans
`backend/app/importer/colonnes.py` : si un libellé du classeur v2.4 n'est pas reconnu, il apparaît
dans « colonnes non reconnues » du rapport et il suffit d'ajouter l'alias.

| Onglet | Colonnes principales (exemples de libellés acceptés) |
|---|---|
| **Base** | ID · Raison sociale · Sigle · NINEA · RCCM · Code NAEMA / NAF · Libellé NAEMA · Activité · Forme juridique · Adresse · Ville · Région · Téléphone · Téléphone 2 · E-mail · Site web · Dirigeant / Contact · Fonction · Segment · Taille · Effectif · Chiffre d'affaires · Capital · Import · Export · Commercial · Vague manuelle · Statut validation · Nb fiches · Score · Catégorie · Vague · Cliente |
| **Call Tracker** | ID entreprise · Date · Type · Tentative · Joint · Décideur · RDV · Date RDV · Résultat · Prochaine action · Date prochaine action · Commercial · Commentaire |
| **Qualification FX** | ID · Devises · Volume annuel · Fréquence · Banque actuelle · Besoin confirmé · Spot · Forward · Flexiterme · Transferts (ou Produits) · Import confirmé · Export confirmé · Potentiel · Qualifiée · Date qualification · Commentaire |
| **Pipeline** | ID · Opportunité · Produit · Étape · Montant · Devise · Marge (pb) · Probabilité · Date ouverture · Date clôture · Commercial · Commentaire |
| **Corrections** | ID · Champ · Avant · Après · Auteur · Date · Motif |
| **Doublons** | ID 1 · ID 2 · Critère · Décision · Commentaire · ID principal |
| **Paramètres** | deux colonnes clé / valeur : Seuil A, Seuil B, Seuil C, Objectif couverture, Durée objectif, Date de lancement, Vagues lancées, Marge par défaut (pb), Option grande taille, Jeu de données |
| **Scoring** | tableaux Excel nommés `Segments` (Segment, Import, Export, Intensité, Fréquence, Couverture, Potentiel, Vague, Accroche) et `Tailles` (Taille, Ordre, Intensité, Fréquence, Potentiel) ; à défaut, blocs dont l'en-tête commence par « Segment » / « Taille » |

Les colonnes **Score, Catégorie, Vague** de la Base ne sont pas reprises telles quelles :
l'application recalcule et **compare** ; les écarts sont listés dans le rapport (contrôle de fidélité
des règles, voir LIMITES.md).

Le commercial est rapproché d'un compte utilisateur par son nom, son identifiant, son e-mail ou son
« alias classeur » (plusieurs alias séparés par `;`). Un nom inconnu est signalé, et l'attribution
sera reprise au réimport une fois le compte créé.

## 3. Base du moteur `radar.db` (lecture seule)

| Table | Colonnes recherchées |
|---|---|
| `files` | id · filename / nom / path · pages |
| `sources` (une fiche extraite) | id · file_id · page · *autres colonnes = valeurs extraites* (raison_sociale, ninea, telephone…) · entity_id (optionnel) |
| `entity_map` | source_id · entity_id |
| `entity_alias` | old_id / alias_id · new_id / canonical_id |

**Provenance champ par champ.** Pour chaque champ d'une entreprise, l'application cherche parmi ses
fiches celle dont la valeur extraite est identique (après normalisation) ; à défaut, elle retient
la première fiche rattachée et affiche « (approx.) ». La fiche 360° montre pour chaque champ le PDF
et la page, avec un lien vers le PDF à la page (et vers une image PNG de la page si PyMuPDF est installé).

## 4. Modèle de données (application)

| Table | Rôle |
|---|---|
| `entreprises` | ID moteur (clé), identité (NINEA, RCCM, **code NAEMA distinct du RCCM**), contacts professionnels, segment, taille, hypothèses import/export, validation, commercial, vague manuelle, champs dérivés (score, détail, catégorie, vague, règle), statut Active / Fusionnée, `champs_verrouilles`, `fictif` |
| `fichiers_pdf`, `fiches`, `provenances` | traçabilité PDF + page (données techniques du moteur, remplacées à chaque import) |
| `entite_alias` | ancien ID → nouvel ID (origine moteur ou décision de doublon) |
| `interactions` | Call Tracker |
| `qualifications` | Qualification FX (une par entreprise) |
| `opportunites` | Pipeline |
| `corrections` | corrections tracées (avant, après, auteur, date, motif, origine) |
| `doublons` | paires candidates, critères, niveau, décision, auteur, date |
| `segments`, `tailles`, `parametres`, `objectifs` | paramétrage |
| `utilisateurs` | comptes (rôle, hachage PBKDF2, lien Entra ID) |
| `journal_audit` | journal en ajout seul |
| `imports` | historique et rapports d'import |
