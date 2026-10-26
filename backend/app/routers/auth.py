"""Connexion : comptes locaux et, si la DSI l'autorise, Microsoft Entra ID (OIDC)."""
from __future__ import annotations

import secrets
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import parametres as P
from ..config import get_settings
from ..db import get_db
from ..models import Entreprise, Utilisateur
from ..security import (
    COOKIE,
    bloque,
    creer_jeton,
    echec,
    hacher,
    mot_de_passe_valide,
    reussite,
    utilisateur_courant,
    verifier,
)

router = APIRouter(prefix="/api/auth", tags=["Authentification"])


class Identifiants(BaseModel):
    login: str
    mot_de_passe: str


class ChangementMdp(BaseModel):
    ancien: str
    nouveau: str


def profil(u: Utilisateur, db: Session) -> dict:
    params = P.charger(db)
    return {"id": u.id, "login": u.login, "nom": u.nom, "email": u.email, "role": u.role,
            "fx_sales_voit_toute_base": params.get("fx_sales_voit_toute_base", False),
            "jeu_fictif": db.query(Entreprise.id).filter(Entreprise.fictif.is_(True)).first() is not None}


def _poser_cookie(response: Response, user: Utilisateur) -> None:
    s = get_settings()
    response.set_cookie(COOKIE, creer_jeton(user), httponly=True, secure=s.cookie_secure, samesite="strict",
                        max_age=s.token_ttl_minutes * 60, path="/")


@router.get("/config")
def config() -> dict:
    s = get_settings()
    return {"entra_active": s.entra_enabled, "comptes_locaux": s.local_auth_enabled}


@router.post("/login")
def login(data: Identifiants, response: Response, db: Session = Depends(get_db)) -> dict:
    if not get_settings().local_auth_enabled:
        raise HTTPException(403, "Comptes locaux désactivés : utilisez Microsoft 365")
    cle = data.login.strip().lower()
    if bloque(cle):
        raise HTTPException(429, "Trop de tentatives. Réessayez dans 5 minutes.")
    user = db.query(Utilisateur).filter(Utilisateur.login == cle).first()
    if user is None or not user.actif or not verifier(data.mot_de_passe, user.mot_de_passe_hash):
        echec(cle)
        raise HTTPException(401, "Identifiant ou mot de passe incorrect")
    reussite(cle)
    _poser_cookie(response, user)
    return profil(user, db)


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: Utilisateur = Depends(utilisateur_courant), db: Session = Depends(get_db)) -> dict:
    return profil(user, db)


@router.post("/mot-de-passe")
def changer_mdp(data: ChangementMdp, user: Utilisateur = Depends(utilisateur_courant), db: Session = Depends(get_db)) -> dict:
    if not verifier(data.ancien, user.mot_de_passe_hash):
        raise HTTPException(400, "Mot de passe actuel incorrect")
    if err := mot_de_passe_valide(data.nouveau):
        raise HTTPException(422, err)
    user.mot_de_passe_hash = hacher(data.nouveau)
    db.commit()
    return {"ok": True}


# --- Microsoft Entra ID ----------------------------------------------------------------
# Flux « authorization code » côté serveur. Seuls les comptes déjà créés par le
# Responsable (même adresse e-mail) peuvent se connecter : aucune création automatique.

def _autorite() -> str:
    return f"https://login.microsoftonline.com/{get_settings().entra_tenant_id}"


@router.get("/entra/login")
def entra_login() -> RedirectResponse:
    s = get_settings()
    if not s.entra_enabled:
        raise HTTPException(404, "Microsoft Entra ID non configuré")
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    url = f"{_autorite()}/oauth2/v2.0/authorize?" + urlencode({
        "client_id": s.entra_client_id, "response_type": "code", "redirect_uri": s.entra_redirect_uri,
        "response_mode": "query", "scope": "openid profile email", "state": state, "nonce": nonce})
    resp = RedirectResponse(url)
    resp.set_cookie("radar_oidc", f"{state}.{nonce}", httponly=True, secure=s.cookie_secure, samesite="lax", max_age=600)
    return resp


def utilisateur_depuis_claims(db: Session, claims: dict) -> Utilisateur:
    """Associe les revendications Entra ID à un compte existant (oid, sinon e-mail)."""
    oid = claims.get("oid")
    email = (claims.get("preferred_username") or claims.get("email") or "").lower()
    user = db.query(Utilisateur).filter(Utilisateur.entra_oid == oid).first() if oid else None
    if user is None and email:
        user = db.query(Utilisateur).filter(Utilisateur.email == email).first()
        if user is not None and oid and user.entra_oid is None:
            user.entra_oid = oid
    if user is None or not user.actif:
        raise HTTPException(403, "Compte Microsoft 365 non autorisé : demandez l'ouverture d'un accès au Responsable Capital Market")
    return user


@router.get("/entra/callback")
def entra_callback(request: Request, code: str, state: str, db: Session = Depends(get_db)) -> RedirectResponse:
    s = get_settings()
    if not s.entra_enabled:
        raise HTTPException(404, "Microsoft Entra ID non configuré")
    attendu = request.cookies.get("radar_oidc", "")
    st, _, nonce = attendu.partition(".")
    if not st or not secrets.compare_digest(st, state):
        raise HTTPException(400, "État OIDC invalide")
    tok = httpx.post(f"{_autorite()}/oauth2/v2.0/token", data={
        "client_id": s.entra_client_id, "client_secret": s.entra_client_secret, "grant_type": "authorization_code",
        "code": code, "redirect_uri": s.entra_redirect_uri, "scope": "openid profile email"}, timeout=15)
    if tok.status_code != 200:
        raise HTTPException(401, "Échec de l'authentification Microsoft 365")
    id_token = tok.json().get("id_token")
    jwks = jwt.PyJWKClient(f"{_autorite()}/discovery/v2.0/keys")
    key = jwks.get_signing_key_from_jwt(id_token)
    claims = jwt.decode(id_token, key.key, algorithms=["RS256"], audience=s.entra_client_id,
                        issuer=f"{_autorite()}/v2.0")
    if claims.get("nonce") != nonce:
        raise HTTPException(400, "Nonce OIDC invalide")
    user = utilisateur_depuis_claims(db, claims)
    db.commit()
    resp = RedirectResponse("/")
    resp.delete_cookie("radar_oidc")
    _poser_cookie(resp, user)
    return resp
