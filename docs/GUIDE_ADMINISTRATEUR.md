# Guide administrateur — SUNU FX SALES RADAR

## 1. Hébergement

Hébergement **interne** de la banque (serveur ou poste local). L'application n'appelle aucun
service externe, à l'exception — uniquement si la DSI l'active — de Microsoft Entra ID pour
l'authentification (`login.microsoftonline.com`). Les PDF CCI restent dans un dossier interne monté
en lecture seule ; ils ne sont jamais transmis ailleurs.

| Mode | Base | Usage |
|---|---|---|
| Poste local | SQLite (`RADAR_DATABASE_URL=sqlite:///./radar_app.db`) | 1 utilisateur ou démonstration |
| Serveur | PostgreSQL 16 (`postgresql+psycopg://…`) | équipe (3 à 5 FX Sales + Responsable) |

Installation : voir le README (Windows, Linux, Docker).

## 2. Configuration (variables d'environnement)

Aucun secret dans le code : tout passe par l'environnement ou un fichier `.env` non versionné
(modèle : `.env.example`).

| Variable | Rôle |
|---|---|
| `RADAR_SECRET_KEY` | clé de signature des sessions (≥ 48 caractères aléatoires). **Obligatoire en production** : sans elle, une clé éphémère est générée et les sessions sont perdues à chaque redémarrage (`/api/sante` renvoie `cle_ephemere: true`). |
| `RADAR_DATABASE_URL` | base de données |
| `RADAR_PDF_DIR` | dossier des PDF CCI (chemins relatifs de la table `files`) |
| `RADAR_COOKIE_SECURE` | `true` derrière HTTPS (obligatoire en production) |
| `RADAR_TOKEN_TTL_MINUTES` | durée de session (600 par défaut) |
| `RADAR_LOCAL_AUTH` | `false` pour n'autoriser que Microsoft 365 |
| `RADAR_ENTRA_*` | Entra ID : tenant, client, secret, URI de redirection |
| `RADAR_ALLOWED_ORIGINS` | origines CORS (vide par défaut : interface servie par la même origine) |

## 3. HTTPS et réseau

Exposer l'application uniquement sur le réseau interne, derrière un reverse proxy HTTPS (certificat
interne de la banque) ; puis `RADAR_COOKIE_SECURE=true`. Le chiffrement du transport est assuré par
ce proxy, et le chiffrement au repos par les mécanismes de la DSI (chiffrement disque / PostgreSQL) :
l'application elle-même **ne chiffre pas** la base (voir LIMITES.md).

## 4. Comptes et rôles

Premier Responsable : `python scripts/creer_utilisateur.py --login … --nom … --role responsable --email …`
(mot de passe saisi de façon masquée, 12 caractères minimum, lettres et chiffres). Les comptes
suivants se créent dans **Paramètres → Utilisateurs**.

- Renseignez l'**alias classeur** de chaque commercial (nom tel qu'il apparaît dans les colonnes
  « Commercial » du classeur, plusieurs alias séparés par `;`) **avant** le premier import, pour que
  les attributions et les saisies soient rattachées.
- Désactivez un compte plutôt que de le supprimer (historique et audit conservés).
- Mots de passe hachés en PBKDF2-SHA256 (310 000 itérations, sel aléatoire) ; 5 échecs de connexion
  bloquent l'identifiant 5 minutes.

### Microsoft Entra ID (si autorisé par la DSI)

1. Inscrire une application dans Entra ID (type Web), URI de redirection
   `https://<serveur>/api/auth/entra/callback`, créer un secret client.
2. Renseigner `RADAR_ENTRA_TENANT_ID`, `RADAR_ENTRA_CLIENT_ID`, `RADAR_ENTRA_CLIENT_SECRET`,
   `RADAR_ENTRA_REDIRECT_URI`.
3. Créer chaque utilisateur dans l'application avec son **e-mail Microsoft 365** : seuls les comptes
   existants peuvent se connecter (aucune création automatique) ; le rôle reste géré dans l'application.

## 5. Import

Première mise en service et à chaque nouvelle version du classeur ou de `radar.db` :

1. Sauvegarder la base (§ 7).
2. Lancer une **simulation** (écran Imports, case cochée, ou `scripts/importer.py --simulation`).
3. Lire le rapport : colonnes non reconnues, commerciaux inconnus, anomalies, écarts de
   score / catégorie / vague avec le classeur.
4. Lancer l'import réel. Le rapport est conservé dans l'historique.

L'import est idempotent : il peut être relancé sans risque. Format détaillé : [IMPORT.md](IMPORT.md).

## 6. Paramètres

Seuils A/B/C, objectif de couverture (pourcentage et durée), date de lancement, vagues lancées,
option « Grande taille → vague 1 », marge par défaut (pb), étapes du pipeline et probabilités, taux
de conversion FCFA, points des segments (avec vague par défaut et accroche) et des tailles, taille de
l'échantillon qualité, visibilité de toute la base par les FX Sales. Chaque modification recalcule
immédiatement toute la base et est tracée dans le journal d'audit.

## 7. Sauvegarde et restauration

- PostgreSQL : `pg_dump -Fc radar > radar_AAAAMMJJ.dump` (quotidien, conservé selon la politique de
  la banque) ; restauration : `pg_restore -c -d radar radar_AAAAMMJJ.dump`.
- SQLite : copier le fichier `.db` application arrêtée (ou `sqlite3 radar_app.db ".backup sauvegarde.db"`).
- Conserver aussi les versions du classeur et de `radar.db` importées.

## 8. Journal d'audit

Écran **Journal d'audit** (Responsable) : filtres par table, action, utilisateur, ID ; export Excel.
Sont tracés : créations, modifications (ancienne et nouvelle valeur des seuls champs modifiés),
suppressions (valeur supprimée), imports (résumé du rapport) et exports. Les champs recalculés
(score, catégorie, vague) ne sont pas tracés individuellement : ils découlent des saisies tracées.
Le journal est en ajout seul au niveau de l'application. Pour une protection au niveau de la base,
retirer à l'utilisateur PostgreSQL de l'application les droits `UPDATE` et `DELETE` sur la table
`journal_audit` :

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON journal_audit FROM radar;
```

## 9. Données personnelles

Seuls des contacts professionnels sont stockés (nom, fonction, téléphone et e-mail professionnels).
Aucune pièce d'identité. Les champs de commentaire rappellent cette règle ; le contrôle reste de la
responsabilité des utilisateurs.

## 10. Supervision

`GET /api/sante` renvoie `{"statut": "ok"}`. Le conteneur Docker l'utilise comme healthcheck.
Documentation technique de l'API (réservée au réseau interne) : `/api/docs`.
