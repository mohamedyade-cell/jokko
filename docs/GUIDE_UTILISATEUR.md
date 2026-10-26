# Guide utilisateur — SUNU FX SALES RADAR

Conventions : dates au format **jj/mm/aaaa**, montants en **FCFA** avec séparateur de milliers.
Les montants en devise sont convertis en FCFA avec les taux fixés par le Responsable (EUR : 655,957).

## Connexion et rôles

Connectez-vous avec votre identifiant ou, si la DSI l'a activé, avec Microsoft 365.

| Rôle | Peut voir | Peut saisir |
|---|---|---|
| **FX Sales** | ses entreprises (et toute la base en lecture si le Responsable l'autorise) | interactions, qualification, opportunités, corrections sur **ses** entreprises ; modifier ou supprimer **ses** saisies |
| **Responsable Capital Market** | tout | tout, plus attribution, vagues manuelles, décisions de doublons, paramètres, utilisateurs, imports, journal d'audit |
| **Lecture seule** | tout | rien |

Chaque création, modification ou suppression est enregistrée dans le journal d'audit.

## Tableau de bord

- **Volumes** : fiches extraites des PDF, entreprises uniques, base validée, interactions.
- **Entonnoir** (entreprises actives ayant atteint chaque stade) :
  - *Ciblées* : fiche validée et vague lancée ;
  - *Attribuées* : un commercial est désigné ;
  - *Contactées* : au moins une interaction ;
  - *Jointes* : au moins une interaction « joint » ;
  - *Décideur joint* ; *Qualifiées* (qualification FX cochée « qualifiée ») ;
  - *RDV* : RDV obtenu ou interaction de type RDV / Visite ;
  - *Opportunité* : au moins une opportunité au pipeline ;
  - *Cliente* : statut client ou opportunité à l'étape « Gagnée ».
- **Couverture** : contactées parmi la base validée / base validée, comparée à l'objectif
  (50 % en 6 mois par défaut) et à l'objectif attendu à date (proportionnel au temps écoulé depuis la
  date de lancement).
- **Taux** : joignabilité = jointes / contactées ; RDV = RDV / jointes ; conversion = clientes /
  entreprises avec opportunité.
- Répartitions par catégorie, vague et segment (total / contactées), suivi 12 semaines et 12 mois,
  pipeline (ouvert, pondéré par la probabilité, PNB estimé = montant FCFA × marge en pb / 10 000),
  performance par commercial (avec objectifs).
- Un FX Sales voit son propre périmètre ; le Responsable peut filtrer par commercial.
- **Rapport PDF** : rapport hebdomadaire téléchargeable.

## Base entreprises

Recherche plein texte : nom, sigle, NINEA, RCCM, téléphone (avec ou sans espaces), ID.
Filtres : segment, catégorie, vague, taille, région, commercial, statut commercial, validation.
Le **code NAEMA (NAF)** et le **RCCM** sont deux colonnes distinctes. Boutons Excel / CSV : export de
la vue filtrée.

## Fiche entreprise 360°

- En-tête : score /100, catégorie, vague (survolez « vague » pour voir la règle appliquée).
- **Identité et contacts** : chaque valeur affiche sa source (PDF + page, lien vers le PDF et l'image
  de la page). « (approx.) » : la valeur n'a pas été retrouvée telle quelle, la page indiquée est
  celle de la fiche de rattachement. « corrigé » : la valeur a été corrigée et est protégée contre
  les imports.
- **Corriger** un champ : saisissez la nouvelle valeur et un motif. La correction est tracée
  (avant, après, auteur, date). L'application refuse un code NAEMA saisi comme RCCM et inversement.
- **Score détaillé** : points, plafond et origine de chaque critère (*confirmé* = Qualification FX ou
  Call Tracker, *base* = base CCI, *segment* / *taille* = hypothèse du barème).
- **Accroche commerciale** du segment.
- Onglets : historique des interactions, qualification FX, opportunités, corrections, fiches PDF.

## Scoring (100 points)

| Critère | Max | Valeur confirmée (prioritaire) | Hypothèse |
|---|---|---|---|
| Import | 20 | Import confirmé Oui/Non | base CCI, sinon segment |
| Export | 20 | Export confirmé Oui/Non | base CCI, sinon segment |
| Intensité | 15 | volume annuel FX (paliers) | taille, sinon segment |
| Fréquence | 15 | fréquence confirmée | max(segment, taille) |
| Couverture | 10 | besoin confirmé / Forward, Flexiterme | segment |
| Accessibilité | 10 | décideur joint = 10 | téléphone 4 + e-mail 3 + contact nommé 3 |
| Potentiel | 10 | potentiel confirmé | segment, sinon taille |

Catégories : A ≥ 75, B ≥ 55, C ≥ 35, sinon D (seuils paramétrables). Le recalcul est immédiat après
chaque saisie.

## Vagues (ordre de priorité)

1. Vague manuelle (Responsable).
2. Banques et établissements financiers → 4.
3. Catégorie A → 1.
4. Taille « Grande » → 1 (option paramétrable, hors « Autres secteurs »).
5. Catégorie D → 4.
6. Vague par défaut du segment.

## Call Tracker (téléphone)

1. Recherchez l'entreprise (ou touchez une relance du jour).
2. Touchez « Appeler » pour composer le numéro.
3. Choisissez le type, indiquez joint / décideur / RDV (date du RDV), le résultat, la prochaine action
   et sa date (raccourcis « Demain », « +1 sem. »…), puis enregistrez.

Une nouvelle interaction solde automatiquement les relances encore ouvertes sur l'entreprise.
N'inscrivez que des informations professionnelles (aucune pièce d'identité, aucune donnée personnelle
sensible).

## Agenda

Relances en retard, du jour, à venir (7, 14 ou 30 jours) et RDV. Bouton « Fait » pour solder une
relance. Le Responsable peut filtrer par commercial.

## Qualification FX

Onglet de la fiche : devises, volume annuel, fréquence, banque actuelle, besoin de couverture,
produits (Spot, Forward, Flexiterme, Transferts), import / export confirmés, potentiel. Chaque valeur
confirmée remplace l'hypothèse dans le score.

## Pipeline

Vue Kanban des 13 étapes : glissez une carte d'une colonne à l'autre ou utilisez la liste « étape ».
Chaque opportunité porte montant, devise, marge en points de base (défaut paramétré), probabilité
(défaut selon l'étape), dates d'ouverture et de clôture. Passer à « Gagnée » marque l'entreprise cliente.

## Sales Wallet

Portefeuille, répartition A/B/C/D et progression vers les objectifs de chaque commercial.
Le Responsable sélectionne des cibles prioritaires non attribuées (vagues lancées, par score) et les
attribue en masse.

## Doublons

Paires probables classées *fort* (NINEA ou RCCM identique), *moyen* (téléphone ou e-mail identique),
*faible* (nom proche dans la même ville). Comparaison côte à côte (valeurs identiques surlignées).
Le Responsable décide « Doublon confirmé » (en choisissant l'ID conservé) ou « Entreprises
distinctes ». **Jamais de fusion sur le seul nom** : une paire « nom seul » exige une justification
(identifiant vérifié, appel…). Une fusion ne supprime rien : l'ID secondaire devient un alias.

## Contrôle qualité

Anomalies (RCCM non conforme ou contenant un code NAEMA, NINEA, téléphone, e-mail, absence de
contact, de segment, de taille ou de source), fiches à vérifier (bouton « Valider »), échantillon de
contrôle reproductible (même graine = même échantillon, par défaut la semaine en cours), historique
des corrections.

## Exports

Excel ou CSV (séparateur « ; », compatible Excel français) de chaque vue ; rapport hebdomadaire PDF.
Les exports d'un jeu de démonstration portent la mention « DONNÉES FICTIVES ».
