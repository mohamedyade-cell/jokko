# Jokko

**Jokko** combine en une seule plateforme :

| Brique | Inspiré de | Fonctionnalités |
| --- | --- | --- |
| Réseau professionnel | LinkedIn | Profils, expériences, compétences, invitations / relations, fil d'actualité |
| Job board | Indeed | Recherche d'offres (mot-clé, ville, contrat, télétravail), candidature en un clic avec CV, suivi des candidatures |
| ATS | Greenhouse, Lever… | Offres par entreprise, pipeline kanban (glisser-déposer), notation, notes d'équipe, historique, CV, statistiques par source |
| Multidiffusion | — | Flux XML **Indeed** et **LinkedIn**, webhook de réception des candidatures externes |

## Démarrage rapide

Prérequis : **Node.js 22.5+** (utilise le module SQLite intégré `node:sqlite`, aucune base externe).

```bash
npm install
npm run seed      # données de démo (facultatif)
npm start         # http://localhost:3000
npm test          # tests de bout en bout
```

Comptes de démo (mot de passe `motdepasse123`) :

- Recruteur : `rh@teranga.test` → onglet **ATS**
- Candidat : `moussa@candidat.test` → **Emplois**, **Candidatures**, **Réseau**

Configuration : voir `.env.example` (variables d'environnement).

## Parcours

**Candidat** : inscription → profil (titre, compétences, expériences) → recherche d'offres → candidature avec CV → suivi de l'étape dans « Mes candidatures ».

**Recruteur** : inscription avec le nom de l'entreprise → création d'une offre (cases « LinkedIn » / « Indeed » pour la multidiffusion) → pipeline kanban : `Nouveau → Présélection → Entretien → Test technique → Offre → Embauché / Refusé`. Chaque déplacement est historisé ; l'équipe peut noter (1–5 ★) et commenter chaque candidat. Les candidatures venant de Jokko, LinkedIn et Indeed arrivent dans le même pipeline, filtrable par source.

## Intégration LinkedIn et Indeed

### 1. Diffuser les offres (flux XML)

| Plateforme | URL du flux | Où la déclarer |
| --- | --- | --- |
| Indeed | `https://<votre-domaine>/feeds/indeed.xml` | Indeed Employer / partenaire ATS (format « Indeed XML Feed ») |
| LinkedIn | `https://<votre-domaine>/feeds/linkedin.xml` | LinkedIn Talent Solutions – « Job Wrapping / XML Feed » (via votre chargé de compte LinkedIn) |

Seules les offres **ouvertes** avec la case correspondante cochée apparaissent ; clôturer une offre la retire des flux au prochain passage du robot. Les liens de candidature pointent vers Jokko avec `utm_source=indeed|linkedin`.

### 2. Recevoir les candidatures (webhook)

```
POST /api/integrations/{indeed|linkedin}/applications
Authorization: Bearer <INTEGRATION_TOKEN>
Content-Type: application/json
```

Format **Indeed Apply** accepté tel quel :

```json
{
  "id": "indeed-apply-789",
  "job": { "jobId": "jokko-12" },
  "applicant": {
    "fullName": "Cheikh Gueye",
    "email": "cheikh@example.com",
    "phoneNumber": "+221770000000",
    "coverletter": "…",
    "resume": { "file": { "fileName": "cv.pdf", "data": "<base64>" } }
  }
}
```

Format générique (LinkedIn ou connecteur tiers — Zapier, Make, etc.) :

```json
{ "jobId": 12, "applicant": { "firstName": "Aminata", "lastName": "Ba", "email": "aminata@example.com" } }
```

Réponses : `201` créée, `200` doublon (même e-mail pour la même offre), `400` données invalides, `401` jeton invalide, `404` offre inconnue ou clôturée, `503` intégration désactivée (`INTEGRATION_TOKEN` vide). Si l'e-mail correspond à un compte candidat Jokko, la candidature y est rattachée.

> **Bon à savoir** : l'API « Apply Connect » de LinkedIn et l'API « Job Sync » d'Indeed sont réservées aux partenaires ATS agréés. Les flux XML + webhook ci-dessus fonctionnent sans ce statut ; le jour où vous l'obtenez, il suffit de brancher leurs appels sur le même webhook.

## Architecture

```
src/
  app.js            configuration Express (sessions, CSRF, routes)
  db.js             schéma SQLite, étapes du pipeline, types de contrat
  applications.js   création d'une candidature (interne ou externe)
  routes/
    auth.js         inscription / connexion
    feed.js         accueil et fil d'actualité
    profile.js      profils et expériences
    network.js      invitations et relations
    jobs.js         recherche, détail, candidature
    ats.js          tableau de bord, offres, pipeline, fiche candidat
    feeds.js        flux XML Indeed / LinkedIn
    integrations.js webhook de candidatures externes
  views/            gabarits EJS
public/             CSS et glisser-déposer du kanban
test/               tests (node:test + supertest)
```

Sécurité : mots de passe bcrypt, jeton CSRF sur tous les formulaires, cookies `httpOnly` + `SameSite=Lax`, échappement HTML systématique, CV servis uniquement aux recruteurs de l'entreprise concernée (PDF/DOC/DOCX, 5 Mo max), cloisonnement des données par entreprise.

### Avant la mise en production

- Définir `SESSION_SECRET`, `BASE_URL`, `INTEGRATION_TOKEN` et `NODE_ENV=production` (active les cookies `secure`).
- Remplacer le stockage de sessions en mémoire par un store persistant (ex. Redis ou un store SQLite).
- Sauvegarder `data/` et `uploads/` (ou déplacer les CV vers un stockage objet).
- Pistes suivantes : notifications e-mail, messagerie, plusieurs recruteurs par entreprise avec rôles, planification d'entretiens, analyse automatique des CV.
