# Limites connues et règles à confirmer

## 1. Règles reconstituées faute d'accès au classeur v2.4

Le classeur réel et `radar.db` n'étaient pas disponibles pendant le développement. L'application a
été construite et testée sur un jeu **FICTIF** reproduisant la structure décrite dans le cahier des
charges. Les points suivants appliquent l'interprétation la plus proche du cahier des charges et
**doivent être vérifiés** au premier import réel. Le rapport d'import aide à le faire : il liste les
colonnes non reconnues et compte les **écarts de score, de catégorie et de vague** entre l'application
et les valeurs calculées par le classeur.

| Point | Interprétation retenue | Où l'ajuster |
|---|---|---|
| Libellés des colonnes et des onglets | Liste d'alias courants | `backend/app/importer/colonnes.py` |
| Schéma de `radar.db` (`files`, `sources`, `entity_map`, `entity_alias`) | Détection parmi plusieurs noms de colonnes | `backend/app/importer/moteur.py` |
| Intensité (hypothèse) | Points de la taille, à défaut du segment | `scoring.py` |
| Fréquence (hypothèse) | max(segment, taille), comme indiqué | — |
| Potentiel (hypothèse) | Points du segment, à défaut de la taille | `scoring.py` |
| Accessibilité | Téléphone 4 + e-mail 3 + contact nommé 3 ; décideur joint = 10 | Paramètre `accessibilite_points` |
| Paliers d'intensité confirmée (volume annuel FCFA) | ≥ 5 Md : 15 · ≥ 1 Md : 12 · ≥ 500 M : 9 · ≥ 100 M : 6 · sinon 3 | Paramètre `intensite_paliers_fcfa` |
| Points de fréquence / potentiel confirmés | Quotidienne 15, Hebdomadaire 12, Mensuelle 9, Trimestrielle 5, Ponctuelle 2 ; Élevé 10, Moyen 6, Faible 2 | Paramètres `frequence_points`, `potentiel_points` |
| Arrondi du score | Arrondi commercial (0,5 → supérieur), comme ARRONDI d'Excel | `scoring.py` |
| Libellés des 13 étapes du pipeline | Liste proposée (Identifiée … Gagnée, Perdue) ; une étape inconnue du classeur est rangée en première étape et signalée | Paramètres → Étapes |
| « Vagues lancées = n » dans le classeur | Interprété comme « vagues 1 à n » | Paramètres |
| Définitions de l'entonnoir et des taux | Voir le guide utilisateur (chaque étape comptée indépendamment) | `kpi.py` |
| Vague par défaut si le segment n'en a pas | 3 | Paramètre `vague_defaut` |
| Doublons du classeur marqués « Doublon confirmé » | Fusion appliquée (ID principal = colonne « ID principal », sinon le premier ID) | — |

## 2. Sécurité — ce qui est implémenté et testé, et ce qui ne l'est pas

Implémenté **et** couvert par les tests automatisés : rôles (FX Sales / Responsable / Lecture
seule) et cloisonnement du portefeuille, journal d'audit (création, modification avec ancienne et
nouvelle valeur, suppression, imports, immutabilité au niveau de l'application), hachage des mots de
passe, protection anti-CSRF par en-tête, limitation des tentatives de connexion, refus du mélange
fictif / réel.

Non fourni ou non testé :
- **Chiffrement** : l'application ne chiffre pas la base au repos et ne termine pas TLS elle-même. Le
  chiffrement dépend du reverse proxy HTTPS et des mécanismes de la DSI. Il ne doit pas être déclaré
  opérationnel tant que la DSI ne l'a pas mis en place.
- **Microsoft Entra ID** : le flux OIDC (code d'autorisation, vérification de signature, audience,
  émetteur, nonce) est codé, mais **n'a pas été testé contre un tenant réel**. Seule la mise en
  correspondance revendications → compte existant (sans création automatique) est couverte par un
  test. À recetter avec la DSI avant activation ; les comptes locaux restent disponibles d'ici là.
- Immutabilité du journal au niveau de la base : nécessite le `REVOKE` décrit dans le guide administrateur.
- Le blocage après 5 échecs est conservé en mémoire : il est remis à zéro au redémarrage et n'est pas
  partagé entre plusieurs processus.
- Pas d'expiration forcée des mots de passe ni d'authentification à deux facteurs en comptes locaux
  (Microsoft 365 recommandé pour cela).

## 3. Fonctionnelles et techniques

- **Image Docker non construite** pendant le développement (pas de démon Docker disponible) : le
  `Dockerfile` et `docker-compose.yml` sont fournis mais doivent être construits et testés une première
  fois sur l'infrastructure de la banque. L'application elle-même a été testée sur SQLite et PostgreSQL 16.
- **Image de la page PDF** : nécessite PyMuPDF (`pip install pymupdf`, licence AGPL ou commerciale, à
  valider par la DSI). Sans PyMuPDF, le lien ouvre le PDF à la bonne page dans le navigateur.
- **Provenance « (approx.) »** : si la valeur d'un champ n'est pas retrouvée telle quelle dans les
  fiches du moteur (valeur nettoyée ou consolidée), la page affichée est celle de la première fiche de
  l'entreprise.
- Les données techniques du moteur (fiches, fichiers, provenances) sont **remplacées** à chaque import
  et non journalisées ligne par ligne (8 790 lignes) ; l'import est tracé globalement avec son rapport.
- Les champs dérivés (score, catégorie, vague) sont recalculés à chaque saisie et non journalisés
  individuellement.
- Suppression d'un champ dans le classeur : une valeur vidée dans la Base est aussi vidée dans
  l'application (sauf champ corrigé dans l'application).
- Agenda : chaque rubrique affiche au plus 300 lignes (les totaux restent exacts ; l'export Excel
  contient tout).
- Taux de change : saisis manuellement, uniquement pour agréger le pipeline en FCFA ; pas de flux de
  cotation.
- Pas de mode hors ligne : le Call Tracker mobile nécessite le réseau interne (VPN ou Wi-Fi interne).
- Pas de migrations de schéma automatisées (Alembic) : les tables sont créées au premier lancement ;
  une évolution du modèle nécessitera un script de migration.
- Saisie des dates : champ texte jj/mm/aaaa (indépendant de la langue du navigateur) ; le sélecteur
  de date de l'écran Paramètres l'utilise aussi.
- Performance mesurée par les tests sur 6 000 entreprises et 10 000 interactions (SQLite, poste de
  développement) : listes ≈ 0,04 s, tableau de bord ≈ 0,25 s, agenda ≈ 0,9 s (cas extrême : 10 000
  relances ouvertes). À reconfirmer sur le serveur cible.

## 4. Alternative Power Apps

Non développée. Si la banque l'impose (Power Apps + Dataverse / SharePoint) : délégation limitée des
requêtes (agrégats du tableau de bord à recalculer via Power Automate ou des colonnes calculées),
import idempotent et alias à réécrire en flux Power Automate, journal d'audit à activer côté
Dataverse (indisponible sur SharePoint), pas de lecture directe de `radar.db` (SQLite) sans passerelle,
licences premium nécessaires pour Dataverse.
