"""Authentification (comptes locaux et Microsoft Entra ID) et contrôle des rôles."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .config import get_settings
from .db import current_actor, get_db
from .models import ROLE_FX_SALES, ROLE_LECTURE, ROLE_RESPONSABLE, Utilisateur

COOKIE = "radar_session"
ITERATIONS = int(os.environ.get("RADAR_PBKDF2_ITERATIONS", "310000"))


# --- Mots de passe (PBKDF2-SHA256, sel aléatoire) ---------------------------------

def hacher(mot_de_passe: str, iterations: int | None = None) -> str:
    iterations = iterations or ITERATIONS
    sel = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", mot_de_passe.encode("utf-8"), sel, iterations)
    return f"pbkdf2_sha256${iterations}${base64.b64encode(sel).decode()}${base64.b64encode(dk).decode()}"


def verifier(mot_de_passe: str, empreinte: str | None) -> bool:
    if not empreinte:
        return False
    try:
        algo, it, sel, dk = empreinte.split("$")
        if algo != "pbkdf2_sha256":
            return False
        calc = hashlib.pbkdf2_hmac("sha256", mot_de_passe.encode("utf-8"), base64.b64decode(sel), int(it))
        return hmac.compare_digest(calc, base64.b64decode(dk))
    except (ValueError, TypeError):
        return False


def mot_de_passe_valide(mdp: str) -> str | None:
    """Politique minimale : 12 caractères, lettres et chiffres."""
    if len(mdp) < 12:
        return "Le mot de passe doit contenir au moins 12 caractères."
    if not any(c.isdigit() for c in mdp) or not any(c.isalpha() for c in mdp):
        return "Le mot de passe doit contenir des lettres et des chiffres."
    return None


# --- Limitation des tentatives ------------------------------------------------------

_echecs: dict[str, list[float]] = defaultdict(list)
MAX_ECHECS, FENETRE = 5, 300


def bloque(login: str) -> bool:
    now = time.time()
    _echecs[login] = [t for t in _echecs[login] if now - t < FENETRE]
    return len(_echecs[login]) >= MAX_ECHECS


def echec(login: str) -> None:
    _echecs[login].append(time.time())


def reussite(login: str) -> None:
    _echecs.pop(login, None)


# --- Jetons de session --------------------------------------------------------------

def creer_jeton(user: Utilisateur) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(user.id), "role": user.role, "iat": now,
                       "exp": now + timedelta(minutes=s.token_ttl_minutes)}, s.secret_key, algorithm="HS256")


def _jeton(request: Request) -> tuple[str | None, bool]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:], False
    return request.cookies.get(COOKIE), True


def utilisateur_courant(request: Request, db: Session = Depends(get_db)) -> Utilisateur:
    token, via_cookie = _jeton(request)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentification requise")
    try:
        payload = jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expirée ou invalide")
    user = db.get(Utilisateur, int(payload["sub"]))
    if user is None or not user.actif:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Compte inactif")
    # Protection CSRF : requêtes modifiantes authentifiées par cookie → en-tête personnalisé obligatoire.
    if via_cookie and request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-radar") != "1":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "En-tête X-Radar manquant")
    db.info["actor"] = user.login
    current_actor.set(user.login)
    return user


def exiger(*roles: str):
    def dep(user: Utilisateur = Depends(utilisateur_courant)) -> Utilisateur:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Droits insuffisants pour cette action")
        return user
    return dep


lecteur = exiger(ROLE_FX_SALES, ROLE_RESPONSABLE, ROLE_LECTURE)
saisie = exiger(ROLE_FX_SALES, ROLE_RESPONSABLE)
responsable = exiger(ROLE_RESPONSABLE)
