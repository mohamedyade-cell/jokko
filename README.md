# Jokko

**Un CV ne suffit pas à juger un candidat.** Jokko combine quatre briques qui fonctionnent ensemble, plus un réseau professionnel (type LinkedIn) et un job board (type Indeed) :

| Pilier | Ce que ça fait |
| --- | --- |
| 🎥 **Pitch vidéo** | 90 s enregistrées depuis le téléphone ou l'ordinateur, trame affichée pendant l'enregistrement (0–15 s qui je suis · 15–60 s ce que je sais faire · 60–90 s ce que je cherche), revoir / refaire avant publication, langue au choix (français, wolof, anglais…), vidéo légère (~5 Mo). Affichée en premier sur la carte profil. |
| ✅ **Quiz de compétences** | Par métier et par niveau (Débutant ~5 min, Intermédiaire ~8 min, Avancé ~13 min). Questions tirées au hasard et réponses mélangées, temps limité par question **contrôlé côté serveur**, abandon = échec, délai avant de retenter, badge à durée de validité. |
| 🏅 **Badges et Jokko Score** | Badges issus des quiz, des certifications vérifiées et des écoles Jokko Campus. Score **compétences** plafonné à 100 (meilleur badge valide par compétence) et score **parrainage** calculé à part : parrainer ne compense jamais un manque de compétences. |
| 📋 **ATS intégré** | CVthèque filtrable (badge + niveau, école, score, vidéo, disponibilité), module **besoin urgent** (journaliers / intérimaires disponibles, classés par Jokko Score), **déblocage du CV** avant l'entrée dans le pipeline en 6 étapes, cloisonnement total par entreprise, offres PME / Corporate. |

Plus : profils, relations et fil d'actualité ; recherche d'offres et candidature en un clic ; multidiffusion Indeed / LinkedIn (flux XML) et réception de leurs candidatures (webhook).

## Démarrage rapide

Prérequis : **Node.js 22.5+** (utilise le module SQLite intégré `node:sqlite`, aucune base externe).

```bash
npm install
npm run seed      # données de démo (facultatif)
npm start         # http://localhost:3000
npm test          # tests de bout en bout
```

Comptes de démo (mot de passe `motdepasse123`) :

- Recruteur (offre PME) : `rh@teranga.test` → **CVthèque**, **ATS**
- Candidats : `moussa@candidat.test`, `aissatou@candidat.test` (badges, Jokko Campus, disponible) → **Compétences**, **Profil**
- Équipe Jokko : `admin@jokko.test` → **Admin** (lancer avec `ADMIN_EMAILS=admin@jokko.test`)

Configuration : voir `.env.example` (variables d'environnement).

## Parcours

**Candidat** : inscription → **pitch vidéo** (`/profile/video`) → **quiz** (`/skills`) → badges et Jokko Score → certifications et école partenaire à faire vérifier (`/profile/credentials`) → CV complet (visible seulement après déblocage) → lien de parrainage → candidatures.

**Recruteur** (exemple : une PME de Dakar cherche un assistant comptable) :

1. **CVthèque** : filtre « Dakar » + badge « Comptabilité, Intermédiaire et + », trié par Jokko Score. Les profils affichent pitch, badges et score ; le nom est abrégé (« Aïssatou N. »), sans coordonnées ni expériences.
2. Il regarde les pitchs, puis **débloque le CV** des profils retenus en choisissant le poste : le candidat entre dans le pipeline (étape *Nouveau*).
3. Pipeline : `Nouveau → Présélectionné → Entretien → Offre → Embauché / Rejeté` (glisser-déposer ou un clic), notes d'équipe, évaluation, historique.

Les candidatures spontanées (Jokko, LinkedIn, Indeed) arrivent dans **Candidatures reçues**, également masquées ; les **retenir** les fait entrer dans le pipeline sans consommer de crédit.

**Offres entreprise** (`src/db.js`, `PLANS`) : **PME** – 3 offres ouvertes et 10 déblocages de CV par mois ; **Corporate** – illimité. L'équipe Jokko change l'offre d'une entreprise depuis `/admin`.

**Équipe Jokko** (`/admin`) : vérifie les certifications et les parcours Campus (justificatif téléchargeable) → badge ; gère les écoles partenaires et les offres entreprise.

### Règles de calcul

| Badge | Points |
| --- | --- |
| Quiz Débutant / Intermédiaire / Avancé | 10 / 20 / 30 |
| Certification vérifiée | 20 |
| Jokko Campus | 15 |
| Parrainage (composante séparée) | 10 par filleul |

Seuil de réussite 70 %, délai de 3 jours après un échec, badge valable 12 mois (renouvelable 30 jours avant l'expiration). Réglages : `src/quiz.js`, `src/score.js` et variables `QUIZ_COOLDOWN_DAYS` / `BADGE_VALIDITY_DAYS`.

### Ajouter des quiz

Les questions sont dans `src/quizzes/bank.js` (bonne réponse toujours en premier, l'ordre est mélangé à l'affichage). Ajoutez les nouvelles questions **à la fin** d'un niveau : leur position sert d'identifiant.

### Vidéo

L'enregistreur (`public/pitch.js`) utilise MediaRecorder en 480p à ~400 kbit/s, soit environ 5 Mo pour 90 s. Si le navigateur ne le permet pas, le candidat envoie une vidéo filmée avec son téléphone (durée vérifiée avant envoi). Avec `FFMPEG_PATH`, le serveur recompresse ces fichiers en 480p. Les vidéos ne sont visibles que des membres connectés.

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
  applications.js   création d'une candidature (interne, externe ou CVthèque)
  access.js         déblocage des CV, quotas PME / Corporate
  quiz.js           moteur de quiz (tirage, chronomètre, badges)
  quizzes/bank.js   banque de questions
  score.js          badges et Jokko Score
  video.js          recompression optionnelle (ffmpeg)
  routes/
    auth.js         inscription (parrainage) / connexion
    video.js        pitch vidéo : enregistrement, diffusion
    skills.js       quiz, certifications, Jokko Campus
    talents.js      CVthèque, besoin urgent, déblocage des CV
    admin.js        vérifications, écoles partenaires, offres
    feed.js         accueil et fil d'actualité
    profile.js      profils et expériences
    network.js      invitations et relations
    jobs.js         recherche, détail, candidature
    ats.js          tableau de bord, offres, pipeline, fiche candidat
    feeds.js        flux XML Indeed / LinkedIn
    integrations.js webhook de candidatures externes
  views/            gabarits EJS
public/             CSS, enregistreur vidéo, glisser-déposer du kanban
test/               tests (node:test + supertest)
```

Sécurité : mots de passe bcrypt, jeton CSRF sur tous les formulaires, cookies `httpOnly` + `SameSite=Lax`, échappement HTML systématique, CV et coordonnées servis uniquement aux entreprises qui ont débloqué le candidat, chronomètre des quiz côté serveur (PDF/DOC/DOCX, 5 Mo max), cloisonnement des données par entreprise.

### Avant la mise en production

- Définir `SESSION_SECRET`, `BASE_URL`, `INTEGRATION_TOKEN` et `NODE_ENV=production` (active les cookies `secure`).
- Remplacer le stockage de sessions en mémoire par un store persistant (ex. Redis ou un store SQLite).
- Sauvegarder `data/` et `uploads/` (ou déplacer les CV vers un stockage objet).
- Installer ffmpeg et définir `FFMPEG_PATH` pour recompresser les vidéos envoyées depuis un téléphone ; stocker les vidéos sur un stockage objet / CDN.
- Pistes suivantes : paiement des offres PME / Corporate, notifications e-mail et SMS, plusieurs recruteurs par entreprise, planification d'entretiens, espace école pour Jokko Campus, enrichissement de la banque de questions.
