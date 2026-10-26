# SUNU FX SALES RADAR

Application web interne de la Team Capital Market (FX Sales) de SUNU Bank Sénégal.
Elle remplace l'usage quotidien du classeur `SUNU_FX_SALES_RADAR.xlsx` (v2.4) **sans en changer
les règles, les données ni les identifiants** (`ENT-00001`…).

| Module | Écran |
|---|---|
| Tableau de bord (volumes, entonnoir, couverture vs objectif, taux, répartitions, suivi 12 semaines / 12 mois, performance) | `/` |
| Base entreprises (recherche plein texte, filtres, source PDF + page de chaque champ) | `/base` |
| Fiche entreprise 360° (identité, score détaillé, historique, qualification, opportunités, accroche) | `/entreprises/ENT-…` |
| Call Tracker (saisie rapide, mode mobile) | `/call-tracker` |
| Agenda (relances du jour, en retard, à venir, RDV) | `/agenda` |
| Qualification FX | onglet de la fiche 360° |
| Pipeline (13 étapes, Kanban, montant, devise, marge en pb, probabilité) | `/pipeline` |
| Sales Wallet (portefeuilles, objectifs, attribution en masse) | `/wallet` |
| Doublons (comparaison côte à côte, décisions tracées) | `/doublons` |
| Contrôle qualité (anomalies, fiches à vérifier, échantillon, corrections) | `/qualite` |
| Paramètres, utilisateurs, imports, journal d'audit (Responsable) | `/parametres`, `/imports`, `/audit` |
| Exports Excel / CSV de toute vue filtrée, rapport hebdomadaire PDF | `/exports` |

**Stack :** Python 3.11+ · FastAPI · SQLAlchemy 2 · SQLite (monoposte) ou PostgreSQL 16 (serveur) ·
React 18 + TypeScript + Tailwind · conteneur Docker.

Documentation :
- [Guide utilisateur](docs/GUIDE_UTILISATEUR.md)
- [Guide administrateur](docs/GUIDE_ADMINISTRATEUR.md) (installation, import, sécurité, sauvegardes)
- [Format d'import et modèle de données](docs/IMPORT.md)
- [Limites connues et règles à confirmer](docs/LIMITES.md)

---

## Installation rapide

Prérequis : Python 3.11 ou plus récent, Node.js 20 ou plus récent (uniquement pour construire l'interface).
Aucune connexion à un service externe n'est nécessaire à l'exécution.

### Linux

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cd ../frontend && npm ci && npm run build && cd ../backend

cp ../.env.example ../.env          # puis renseigner RADAR_SECRET_KEY (voir le commentaire du fichier)
python scripts/creer_utilisateur.py --login resp --nom "Prénom Nom" --role responsable --email prenom.nom@sunu.sn
python scripts/importer.py --classeur /chemin/SUNU_FX_SALES_RADAR.xlsx --radar /chemin/moteur/data/radar.db --simulation
python scripts/importer.py --classeur /chemin/SUNU_FX_SALES_RADAR.xlsx --radar /chemin/moteur/data/radar.db
uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

Ouvrir http://127.0.0.1:8000.

### Windows (PowerShell)

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..\frontend; npm ci; npm run build; cd ..\backend

Copy-Item ..\.env.example ..\.env   # puis renseigner RADAR_SECRET_KEY
python scripts\creer_utilisateur.py --login resp --nom "Prénom Nom" --role responsable --email prenom.nom@sunu.sn
python scripts\importer.py --classeur C:\Radar\SUNU_FX_SALES_RADAR.xlsx --radar C:\Radar\moteur\data\radar.db --simulation
python scripts\importer.py --classeur C:\Radar\SUNU_FX_SALES_RADAR.xlsx --radar C:\Radar\moteur\data\radar.db
uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

### Serveur interne (Docker + PostgreSQL)

```bash
cp .env.example .env    # RADAR_SECRET_KEY, POSTGRES_PASSWORD, RADAR_COOKIE_SECURE=true
docker compose up -d --build
docker compose exec app python scripts/creer_utilisateur.py --login resp --nom "…" --role responsable
docker compose exec app python scripts/importer.py --classeur /import/SUNU_FX_SALES_RADAR.xlsx --radar /import/radar.db
```

Placer un reverse proxy HTTPS interne (IIS, Nginx…) devant le port 8000. Détails : guide administrateur.

### Démonstration (données FICTIVES)

```bash
cd backend
RADAR_DATABASE_URL=sqlite:///./radar_demo.db python scripts/demo.py     # Windows : $env:RADAR_DATABASE_URL="sqlite:///./radar_demo.db"
RADAR_DATABASE_URL=sqlite:///./radar_demo.db uvicorn app.main:create_app --factory
```

Le jeu de démonstration est **inventé** (raisons sociales préfixées « [FICTIF] », NINEA `000…`,
RCCM `SN-FIC-…`, e-mails `@fictif.example`). L'interface affiche un bandeau « Données fictives »,
les exports portent la mention FICTIF, et l'import refuse de mélanger jeu fictif et données réelles.
Utilisez toujours une base dédiée pour la démonstration.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest -q
# sur PostgreSQL :
RADAR_TEST_DATABASE_URL="postgresql+psycopg://radar@/radar_test?host=/tmp&port=5432" python -m pytest -q
```

78 tests couvrent : import sans perte d'ID, idempotence et alias, protection des saisies, recalcul du
score et de la catégorie, règles de vague, décisions de doublons, droits par rôle, journal d'audit,
KPI exacts sur un jeu construit à la main, exports, et performance (6 000 entreprises et
10 000 interactions : chaque liste et le tableau de bord répondent en moins de 2 s).
La suite passe sur SQLite et sur PostgreSQL 16.

Contrôle de l'interface : `cd frontend && npm run typecheck`.

## Structure

```
backend/
  app/
    models.py          modèle de données
    importer/          lecture du classeur et de radar.db, import idempotent
    scoring.py         score /100, catégories, vagues (fonctions pures)
    services.py        recalcul, droits d'accès, recherche
    kpi.py             indicateurs du tableau de bord
    doublons.py        détection, fusion par alias, décisions
    corrections.py     corrections tracées (avant/après/auteur/date)
    audit.py           journal d'audit automatique (ajout seul)
    security.py        mots de passe, sessions, rôles
    routers/           API REST
    demo.py            générateur du jeu FICTIF
  scripts/             importer.py, creer_utilisateur.py, demo.py
  tests/
frontend/src/          interface React (pages/, components/)
docs/
```
