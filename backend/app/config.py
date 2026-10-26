"""Configuration de l'application, lue exclusivement depuis les variables d'environnement.

Aucune donnée confidentielle ne doit figurer dans le code source : les secrets
(clé de signature des jetons, identifiants Entra ID, mot de passe PostgreSQL)
sont fournis par l'environnement ou par un fichier `.env` non versionné.
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def _env_bool(name: str, default: bool = False) -> bool:
    value = _env(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "oui", "yes", "on"}


def _load_dotenv() -> None:
    """Charge un fichier .env minimal (clé=valeur) sans dépendance externe.

    Les variables déjà définies dans l'environnement sont prioritaires.
    """
    candidates = [Path(_env("RADAR_ENV_FILE", "") or ""), Path.cwd() / ".env", Path(__file__).resolve().parents[2] / ".env"]
    for path in candidates:
        if path and path.is_file():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
            break


@dataclass(frozen=True)
class Settings:
    database_url: str
    secret_key: str
    secret_key_is_ephemeral: bool
    token_ttl_minutes: int
    pdf_dir: Path | None
    frontend_dist: Path | None
    cookie_secure: bool
    allowed_origins: list[str] = field(default_factory=list)
    # Microsoft Entra ID (optionnel, uniquement si autorisé par la DSI)
    entra_tenant_id: str | None = None
    entra_client_id: str | None = None
    entra_client_secret: str | None = None
    entra_redirect_uri: str | None = None
    local_auth_enabled: bool = True

    @property
    def entra_enabled(self) -> bool:
        return bool(self.entra_tenant_id and self.entra_client_id and self.entra_client_secret and self.entra_redirect_uri)


@lru_cache
def get_settings() -> Settings:
    _load_dotenv()
    secret = _env("RADAR_SECRET_KEY")
    ephemeral = secret is None
    if ephemeral:
        # Clé aléatoire par processus : les sessions sont perdues au redémarrage.
        # Acceptable en test / démonstration, à remplacer en production.
        secret = secrets.token_urlsafe(48)
    pdf_dir = _env("RADAR_PDF_DIR")
    dist = _env("RADAR_FRONTEND_DIST", str(Path(__file__).resolve().parents[2] / "frontend" / "dist"))
    origins = [o.strip() for o in (_env("RADAR_ALLOWED_ORIGINS", "") or "").split(",") if o.strip()]
    return Settings(
        database_url=_env("RADAR_DATABASE_URL", "sqlite:///./radar_app.db"),
        secret_key=secret,
        secret_key_is_ephemeral=ephemeral,
        token_ttl_minutes=int(_env("RADAR_TOKEN_TTL_MINUTES", "600")),
        pdf_dir=Path(pdf_dir) if pdf_dir else None,
        frontend_dist=Path(dist) if dist else None,
        cookie_secure=_env_bool("RADAR_COOKIE_SECURE", False),
        allowed_origins=origins,
        entra_tenant_id=_env("RADAR_ENTRA_TENANT_ID"),
        entra_client_id=_env("RADAR_ENTRA_CLIENT_ID"),
        entra_client_secret=_env("RADAR_ENTRA_CLIENT_SECRET"),
        entra_redirect_uri=_env("RADAR_ENTRA_REDIRECT_URI"),
        local_auth_enabled=_env_bool("RADAR_LOCAL_AUTH", True),
    )
