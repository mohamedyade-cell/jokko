"""Connexion à la base de données (SQLite en monoposte, PostgreSQL recommandé en serveur)."""
from __future__ import annotations

from collections.abc import Iterator
from contextvars import ContextVar

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


# Utilisateur courant, utilisé par le journal d'audit (voir audit.py).
current_actor: ContextVar[str] = ContextVar("current_actor", default="systeme")

_engine: Engine | None = None
SessionLocal = sessionmaker(autoflush=False, expire_on_commit=False)


def _sqlite_pragmas(dbapi_connection, _record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


def init_engine(url: str | None = None) -> Engine:
    """Crée (ou recrée) le moteur SQLAlchemy et crée les tables manquantes."""
    global _engine
    url = url or get_settings().database_url
    kwargs: dict = {"future": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):
        event.listen(engine, "connect", _sqlite_pragmas)
    from . import models  # noqa: F401  (enregistre les tables)
    from .audit import install_audit

    install_audit()
    Base.metadata.create_all(engine)
    SessionLocal.configure(bind=engine)
    _engine = engine
    return engine


def get_engine() -> Engine:
    if _engine is None:
        return init_engine()
    return _engine


def get_db() -> Iterator[Session]:
    get_engine()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
