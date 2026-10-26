"""Fixtures de test : base SQLite temporaire, utilisateurs, jeu FICTIF importé."""
from __future__ import annotations

import os

os.environ.setdefault("RADAR_PBKDF2_ITERATIONS", "1000")  # hachage rapide pour les tests uniquement
os.environ.setdefault("RADAR_SECRET_KEY", "cle-de-test-non-secrete-uniquement-pour-pytest")
os.environ["RADAR_FRONTEND_DIST"] = "/nonexistent"

import pytest
from fastapi.testclient import TestClient

from app import security
from app.db import SessionLocal, init_engine
from app.demo import generer
from app.importer.run import importer
from app.main import create_app
from app.models import Utilisateur

MDP = "MotDePasse2026"
UTILISATEURS = [
    ("resp", "Responsable Test", "responsable", None),
    ("fx1", "Commercial Fictif 1", "fx_sales", None),
    ("fx2", "Commercial Fictif 2", "fx_sales", None),
    ("fx3", "Commercial Fictif 3", "fx_sales", None),
    ("lect", "Lecteur Test", "lecture", None),
]


@pytest.fixture
def db_url(tmp_path):
    # RADAR_TEST_DATABASE_URL=postgresql+psycopg://… : exécute la suite sur PostgreSQL (base vidée à chaque test)
    url = os.environ.get("RADAR_TEST_DATABASE_URL")
    if url:
        from sqlalchemy import create_engine

        from app.db import Base
        from app import models  # noqa: F401

        eng = create_engine(url)
        Base.metadata.drop_all(eng)
        eng.dispose()
        return url
    return f"sqlite:///{tmp_path / 'test.db'}"


@pytest.fixture
def db(db_url):
    init_engine(db_url)
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture
def users(db):
    out = {}
    for login, nom, role, _ in UTILISATEURS:
        u = Utilisateur(login=login, nom=nom, role=role, mot_de_passe_hash=security.hacher(MDP), email=f"{login}@fictif.example")
        db.add(u)
        out[login] = u
    db.commit()
    return out


@pytest.fixture
def demo_files(tmp_path):
    return {1: generer(tmp_path / "v1", n=200, version=1), 2: generer(tmp_path / "v2", n=200, version=2)}


@pytest.fixture
def imported(db, users, demo_files):
    xlsx, radar = demo_files[1]
    rapport = importer(db, "resp", xlsx, radar)
    return rapport


@pytest.fixture
def app(db_url, db):
    security._echecs.clear()
    return create_app(db_url)


def connecter(app, login: str) -> TestClient:
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"login": login, "mot_de_passe": MDP})
    assert r.status_code == 200, r.text
    c.headers["X-Radar"] = "1"
    return c


@pytest.fixture
def clients(app, imported):
    return {login: connecter(app, login) for login, *_ in UTILISATEURS}
