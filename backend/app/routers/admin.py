"""Paramètres, utilisateurs, journal d'audit et imports (Responsable Capital Market)."""
from __future__ import annotations

import shutil
import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import parametres as P
from ..db import get_db
from ..importer.run import ImportRefuse, importer
from ..models import ROLES, ExecutionImport, JournalAudit, Segment, Taille, Utilisateur
from ..security import hacher, lecteur, mot_de_passe_valide, responsable
from ..services import recalculer

router = APIRouter(prefix="/api", tags=["Administration"])


# --- Paramètres -------------------------------------------------------------------------------

@router.get("/parametres")
def lire_parametres(user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict:
    return {
        "valeurs": P.charger(db), "descriptions": P.DESCRIPTIONS,
        "segments": [{c.key: getattr(s, c.key) for c in Segment.__table__.columns} for s in db.query(Segment).order_by(Segment.nom)],
        "tailles": [{c.key: getattr(t, c.key) for c in Taille.__table__.columns} for t in db.query(Taille).order_by(Taille.ordre)],
    }


def _valider_param(cle: str, v: Any) -> Any:
    if cle in {"seuil_A", "seuil_B", "seuil_C", "objectif_couverture_pct"}:
        if not isinstance(v, (int, float)) or not 0 <= v <= 100:
            raise HTTPException(422, f"{cle} : valeur entre 0 et 100 attendue")
    if cle in {"objectif_duree_mois", "echantillon_taille", "vague_defaut"}:
        if not isinstance(v, (int, float)) or v <= 0:
            raise HTTPException(422, f"{cle} : nombre positif attendu")
    if cle == "marge_pb_defaut" and (not isinstance(v, (int, float)) or v < 0):
        raise HTTPException(422, "Marge positive attendue")
    if cle == "vagues_lancees" and (not isinstance(v, list) or not all(isinstance(x, int) for x in v)):
        raise HTTPException(422, "Liste de numéros de vague attendue")
    if cle == "date_lancement" and v:
        try:
            v = date.fromisoformat(str(v)).isoformat()
        except ValueError:
            raise HTTPException(422, "Date attendue (AAAA-MM-JJ)")
    if cle == "etapes_pipeline":
        if not isinstance(v, list) or not v or not all(isinstance(e, dict) and e.get("nom") for e in v):
            raise HTTPException(422, "Liste d'étapes {nom, probabilite} attendue")
    return v


class ValeurIn(BaseModel):
    valeur: Any


@router.put("/parametres/{cle}")
def modifier_parametre(cle: str, data: ValeurIn, user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> dict:
    if cle not in P.DEFAUTS:
        raise HTTPException(404, "Paramètre inconnu")
    v = _valider_param(cle, data.valeur)
    P.definir(db, cle, v)
    db.flush()
    params = P.charger(db)
    if not params["seuil_A"] > params["seuil_B"] > params["seuil_C"]:
        db.rollback()
        raise HTTPException(422, "Les seuils doivent respecter A > B > C")
    n = recalculer(db, params=params)
    db.commit()
    return {"ok": True, "recalculees": n}


class SegmentIn(BaseModel):
    import_pts: float = Field(0, ge=0, le=20)
    export_pts: float = Field(0, ge=0, le=20)
    intensite_pts: float = Field(0, ge=0, le=15)
    frequence_pts: float = Field(0, ge=0, le=15)
    couverture_pts: float = Field(0, ge=0, le=10)
    potentiel_pts: float = Field(0, ge=0, le=10)
    vague_defaut: int | None = Field(None, ge=1, le=9)
    accroche: str | None = None


@router.put("/segments/{nom}")
def modifier_segment(nom: str, data: SegmentIn, user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> dict:
    s = db.get(Segment, nom)
    if s is None:
        s = Segment(nom=nom)
        db.add(s)
    for k, v in data.model_dump().items():
        setattr(s, k, v)
    db.flush()
    n = recalculer(db)
    db.commit()
    return {"ok": True, "recalculees": n}


class TailleIn(BaseModel):
    ordre: int = 0
    intensite_pts: float = Field(0, ge=0, le=15)
    frequence_pts: float = Field(0, ge=0, le=15)
    potentiel_pts: float = Field(0, ge=0, le=10)


@router.put("/tailles/{nom}")
def modifier_taille(nom: str, data: TailleIn, user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> dict:
    t = db.get(Taille, nom)
    if t is None:
        t = Taille(nom=nom)
        db.add(t)
    for k, v in data.model_dump().items():
        setattr(t, k, v)
    db.flush()
    n = recalculer(db)
    db.commit()
    return {"ok": True, "recalculees": n}


# --- Utilisateurs ---------------------------------------------------------------------------------

class UtilisateurIn(BaseModel):
    login: str
    nom: str
    email: str | None = None
    role: str
    actif: bool = True
    alias_classeur: str | None = None
    mot_de_passe: str | None = None


def _u(u: Utilisateur) -> dict:
    return {"id": u.id, "login": u.login, "nom": u.nom, "email": u.email, "role": u.role, "actif": u.actif,
            "alias_classeur": u.alias_classeur, "entra_lie": u.entra_oid is not None}


@router.get("/utilisateurs")
def lister_utilisateurs(user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> list[dict]:
    return [_u(u) for u in db.query(Utilisateur).order_by(Utilisateur.nom)]


@router.post("/utilisateurs", status_code=201)
def creer_utilisateur(data: UtilisateurIn, user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> dict:
    if data.role not in ROLES:
        raise HTTPException(422, f"Rôle attendu : {', '.join(ROLES)}")
    login = data.login.strip().lower()
    if db.query(Utilisateur).filter(Utilisateur.login == login).first():
        raise HTTPException(409, "Identifiant déjà utilisé")
    u = Utilisateur(login=login, nom=data.nom.strip(), email=(data.email or "").lower() or None, role=data.role,
                    actif=data.actif, alias_classeur=data.alias_classeur)
    if data.mot_de_passe:
        if err := mot_de_passe_valide(data.mot_de_passe):
            raise HTTPException(422, err)
        u.mot_de_passe_hash = hacher(data.mot_de_passe)
    db.add(u)
    db.commit()
    return _u(u)


@router.put("/utilisateurs/{uid}")
def modifier_utilisateur(uid: int, data: UtilisateurIn, user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> dict:
    u = db.get(Utilisateur, uid)
    if u is None:
        raise HTTPException(404, "Utilisateur inconnu")
    if data.role not in ROLES:
        raise HTTPException(422, f"Rôle attendu : {', '.join(ROLES)}")
    if u.id == user.id and (data.role != u.role or not data.actif):
        raise HTTPException(422, "Vous ne pouvez pas retirer vos propres droits")
    u.nom, u.email, u.role, u.actif, u.alias_classeur = data.nom.strip(), (data.email or "").lower() or None, data.role, data.actif, data.alias_classeur
    if data.mot_de_passe:
        if err := mot_de_passe_valide(data.mot_de_passe):
            raise HTTPException(422, err)
        u.mot_de_passe_hash = hacher(data.mot_de_passe)
    db.commit()
    return _u(u)


# --- Journal d'audit ----------------------------------------------------------------------------------

@router.get("/audit")
def journal(table: str | None = None, utilisateur: str | None = None, enregistrement_id: str | None = None,
            action: str | None = None, limite: int = 500, user: Utilisateur = Depends(responsable),
            db: Session = Depends(get_db)) -> list[dict]:
    q = db.query(JournalAudit)
    if table:
        q = q.filter(JournalAudit.table_cible == table)
    if utilisateur:
        q = q.filter(JournalAudit.utilisateur == utilisateur)
    if enregistrement_id:
        q = q.filter(JournalAudit.enregistrement_id == enregistrement_id)
    if action:
        q = q.filter(JournalAudit.action == action)
    return [{"id": j.id, "horodatage": j.horodatage.isoformat(), "utilisateur": j.utilisateur, "action": j.action,
             "table": j.table_cible, "enregistrement_id": j.enregistrement_id, "ancienne_valeur": j.ancienne_valeur,
             "nouvelle_valeur": j.nouvelle_valeur} for j in q.order_by(JournalAudit.id.desc()).limit(min(limite, 5000))]


# --- Imports ---------------------------------------------------------------------------------------

@router.get("/imports")
def lister_imports(user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> list[dict]:
    return [{"id": r.id, "debut": r.debut.isoformat(), "fin": r.fin.isoformat() if r.fin else None, "utilisateur": r.utilisateur,
             "fichier_excel": Path(r.fichier_excel).name if r.fichier_excel else None,
             "fichier_db": Path(r.fichier_db).name if r.fichier_db else None, "statut": r.statut,
             "resume": (r.rapport or {}).get("resume")} for r in db.query(ExecutionImport).order_by(ExecutionImport.id.desc())]


@router.get("/imports/{rid}")
def detail_import(rid: int, user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> dict:
    r = db.get(ExecutionImport, rid)
    if r is None:
        raise HTTPException(404, "Import introuvable")
    return {"id": r.id, "debut": r.debut.isoformat(), "statut": r.statut, "rapport": r.rapport}


@router.post("/imports")
def lancer_import(classeur: UploadFile | None = File(None), radar_db: UploadFile | None = File(None),
                  simulation: bool = Form(False), user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> dict:
    if classeur is None and radar_db is None:
        raise HTTPException(422, "Joignez le classeur (.xlsx) et/ou radar.db")
    with tempfile.TemporaryDirectory(prefix="radar_import_") as tmp:
        chemins = {}
        for nom, f, ext in (("classeur", classeur, ".xlsx"), ("radar_db", radar_db, ".db")):
            if f is None:
                continue
            if not (f.filename or "").lower().endswith((ext, ".sqlite", ".sqlite3") if ext == ".db" else (ext, ".xlsm")):
                raise HTTPException(422, f"Format inattendu pour {nom} : {f.filename}")
            dest = Path(tmp) / Path(f.filename or nom).name
            with dest.open("wb") as out:
                shutil.copyfileobj(f.file, out)
            chemins[nom] = dest
        try:
            rapport = importer(db, user.login, chemins.get("classeur"), chemins.get("radar_db"), simulation=simulation)
        except ImportRefuse as exc:
            raise HTTPException(409, str(exc))
    rapport["horodatage"] = datetime.now().isoformat(timespec="seconds")
    return rapport
