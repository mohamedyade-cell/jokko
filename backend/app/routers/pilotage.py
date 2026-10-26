"""Tableau de bord, Sales Wallet, Doublons, Contrôle qualité."""
from __future__ import annotations

import random
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import doublons as D
from .. import kpi
from .. import parametres as P
from ..audit import journaliser
from ..corrections import CorrectionInvalide, corriger
from ..db import get_db
from ..models import (
    ROLE_FX_SALES,
    ROLE_RESPONSABLE,
    STATUT_ACTIVE,
    VALIDATION_A_VERIFIER,
    Correction,
    Entreprise,
    Objectif,
    PaireDoublon,
    ProvenanceChamp,
    Utilisateur,
)
from ..security import lecteur, responsable, saisie
from ..services import filtre_visibilite, recalculer
from ..utils import EMAIL_REGEX, NINEA_REGEX, est_rccm, ressemble_naema, telephone_normalise
from .commun import entreprise_ou_404, item_entreprise

router = APIRouter(prefix="/api", tags=["Pilotage"])


# --- Tableau de bord -------------------------------------------------------------------------

@router.get("/dashboard")
def dashboard(commercial_id: int | None = None, user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict:
    if user.role == ROLE_FX_SALES:
        commercial_id = user.id
    return kpi.calculer(db, commercial_id=commercial_id)


# --- Sales Wallet ------------------------------------------------------------------------------

@router.get("/wallet")
def wallet(user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict:
    data = kpi.calculer(db, commercial_id=user.id if user.role == ROLE_FX_SALES else None)
    repart = {}
    q = db.query(Entreprise.commercial_id, Entreprise.categorie).filter(Entreprise.statut == STATUT_ACTIVE,
                                                                       Entreprise.commercial_id.isnot(None))
    for cid, cat in q:
        repart.setdefault(cid, {"A": 0, "B": 0, "C": 0, "D": 0})[cat] += 1
    for ligne in data["performance"]:
        ligne["par_categorie"] = repart.get(ligne["commercial_id"], {"A": 0, "B": 0, "C": 0, "D": 0})
    non_attr = db.query(Entreprise).filter(Entreprise.statut == STATUT_ACTIVE, Entreprise.commercial_id.is_(None)).count()
    return {"commerciaux": data["performance"], "non_attribuees": non_attr}


@router.get("/wallet/cibles")
def cibles(limite: int = 100, categorie: str = "A,B", vague: int | None = None, segment: str | None = None,
           user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict:
    params = P.charger(db)
    q = db.query(Entreprise).filter(Entreprise.statut == STATUT_ACTIVE, Entreprise.commercial_id.is_(None),
                                    Entreprise.categorie.in_(categorie.split(",")))
    if vague is not None:
        q = q.filter(Entreprise.vague == vague)
    else:
        q = q.filter(Entreprise.vague.in_(params.get("vagues_lancees") or [1]))
    if segment:
        q = q.filter(Entreprise.segment == segment)
    total = q.count()
    items = q.order_by(Entreprise.score.desc(), Entreprise.id).limit(min(limite, 1000)).all()
    return {"total": total, "items": [item_entreprise(e) for e in items]}


class ObjectifIn(BaseModel):
    portefeuille: int | None = Field(None, ge=0)
    contacts: int | None = Field(None, ge=0)
    rdv: int | None = Field(None, ge=0)
    opportunites: int | None = Field(None, ge=0)
    clients: int | None = Field(None, ge=0)
    volume_fcfa: float | None = Field(None, ge=0)


@router.put("/wallet/objectifs/{uid}")
def definir_objectifs(uid: int, data: ObjectifIn, user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> dict:
    if db.get(Utilisateur, uid) is None:
        raise HTTPException(404, "Utilisateur inconnu")
    o = db.get(Objectif, uid)
    if o is None:
        o = Objectif(utilisateur_id=uid)
        db.add(o)
    for k, v in data.model_dump().items():
        setattr(o, k, v)
    db.commit()
    return {"ok": True}


class AttributionIn(BaseModel):
    ids: list[str]
    commercial_id: int | None


@router.post("/wallet/attribuer")
def attribuer(data: AttributionIn, user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> dict:
    if data.commercial_id is not None:
        c = db.get(Utilisateur, data.commercial_id)
        if c is None or not c.actif:
            raise HTTPException(422, "Commercial inconnu ou inactif")
    if len(data.ids) > 2000:
        raise HTTPException(422, "2 000 entreprises maximum par attribution")
    n = 0
    for e in db.query(Entreprise).filter(Entreprise.id.in_([i.upper() for i in data.ids]), Entreprise.statut == STATUT_ACTIVE):
        if e.commercial_id != data.commercial_id:
            e.commercial_id = data.commercial_id
            e.date_attribution = date.today() if data.commercial_id else None
            n += 1
        if "commercial_id" not in (e.champs_verrouilles or []):
            e.champs_verrouilles = [*(e.champs_verrouilles or []), "commercial_id"]
    db.commit()
    return {"attribuees": n}


# --- Doublons ----------------------------------------------------------------------------------

def _cote(db: Session, eid: str) -> dict:
    e = db.get(Entreprise, eid)
    if e is None:
        return {"id": eid, "introuvable": True}
    return {**item_entreprise(e), "email": e.email, "adresse": e.adresse, "contact_nom": e.contact_nom,
            "telephone2": e.telephone2, "activite": e.activite, "nb_fiches": e.nb_fiches,
            "sources": [{"champ": p.champ, "fichier_id": p.fichier_id, "page": p.page}
                        for p in db.query(ProvenanceChamp).filter(ProvenanceChamp.entreprise_id == eid,
                                                                  ProvenanceChamp.champ == "raison_sociale")]}


@router.get("/doublons")
def lister_doublons(statut: str = "a_traiter", niveau: str | None = None, limite: int = 200,
                    user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict:
    q = db.query(PaireDoublon)
    q = q.filter(PaireDoublon.decision.is_(None)) if statut == "a_traiter" else q.filter(PaireDoublon.decision.isnot(None))
    if niveau:
        q = q.filter(PaireDoublon.niveau == niveau)
    paires = q.order_by(PaireDoublon.niveau, PaireDoublon.id).all()
    params = P.charger(db)
    if user.role == ROLE_FX_SALES and not params.get("fx_sales_voit_toute_base"):
        mes = {i for (i,) in db.query(Entreprise.id).filter(Entreprise.commercial_id == user.id)}
        paires = [p for p in paires if p.id_a in mes or p.id_b in mes]
    if statut == "a_traiter":
        actives = {i for (i,) in db.query(Entreprise.id).filter(Entreprise.statut == STATUT_ACTIVE)}
        paires = [p for p in paires if p.id_a in actives and p.id_b in actives]
    ordre = {"fort": 0, "moyen": 1, "faible": 2}
    paires.sort(key=lambda p: (ordre.get(p.niveau, 3), p.id))
    return {"total": len(paires), "items": [{
        "id": p.id, "niveau": p.niveau, "criteres": p.criteres, "decision": p.decision, "id_principal": p.id_principal,
        "justification": p.justification, "decide_par": p.decide_par,
        "decide_le": p.decide_le.isoformat() if p.decide_le else None, "origine": p.origine,
        "nom_seul": not (set(p.criteres or []) - {D.CRITERE_NOM}),
        "a": _cote(db, p.id_a), "b": _cote(db, p.id_b)} for p in paires[:limite]]}


class DecisionIn(BaseModel):
    decision: str
    id_principal: str | None = None
    justification: str | None = None


@router.post("/doublons/{pid}/decision")
def decider(pid: int, data: DecisionIn, user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> dict:
    p = db.get(PaireDoublon, pid)
    if p is None:
        raise HTTPException(404, "Paire introuvable")
    try:
        D.decider(db, p, data.decision, user.login, data.id_principal, data.justification)
    except D.DecisionInvalide as exc:
        db.rollback()
        raise HTTPException(422, str(exc))
    recalculer(db, [p.id_a, p.id_b])
    db.commit()
    return {"ok": True, "decision": p.decision, "id_principal": p.id_principal}


@router.post("/doublons/detecter")
def detecter(user: Utilisateur = Depends(responsable), db: Session = Depends(get_db)) -> dict:
    res = D.detecter(db)
    db.commit()
    return res


# --- Contrôle qualité ----------------------------------------------------------------------------

def anomalies_entreprise(e: Entreprise, avec_source: bool) -> list[dict]:
    a = []
    if e.rccm and not est_rccm(e.rccm):
        a.append({"type": "RCCM non conforme" if not ressemble_naema(e.rccm) else "RCCM contenant un code NAEMA", "champ": "rccm", "valeur": e.rccm})
    if e.naema_code and est_rccm(e.naema_code):
        a.append({"type": "NAEMA contenant un RCCM", "champ": "naema_code", "valeur": e.naema_code})
    if e.ninea and not NINEA_REGEX.match(e.ninea.strip()):
        a.append({"type": "NINEA non conforme", "champ": "ninea", "valeur": e.ninea})
    if e.email and not EMAIL_REGEX.match(e.email.strip()):
        a.append({"type": "E-mail non conforme", "champ": "email", "valeur": e.email})
    for champ in ("telephone", "telephone2"):
        v = getattr(e, champ)
        if v and len(telephone_normalise(v)) != 9:
            a.append({"type": "Téléphone non conforme", "champ": champ, "valeur": v})
    if not e.telephone and not e.telephone2 and not e.email:
        a.append({"type": "Aucun moyen de contact", "champ": "telephone", "valeur": None})
    if not e.segment:
        a.append({"type": "Segment manquant", "champ": "segment", "valeur": None})
    if not e.taille:
        a.append({"type": "Taille manquante", "champ": "taille", "valeur": None})
    if not avec_source:
        a.append({"type": "Aucune source PDF", "champ": None, "valeur": None})
    return a


@router.get("/qualite/anomalies")
def anomalies(type: str | None = None, limite: int = 500, user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict:
    params = P.charger(db)
    sourcees = {i for (i,) in db.query(ProvenanceChamp.entreprise_id).distinct()}
    q = filtre_visibilite(db.query(Entreprise), user, params).filter(Entreprise.statut == STATUT_ACTIVE)
    lignes, compte = [], {}
    for e in q.order_by(Entreprise.id):
        for a in anomalies_entreprise(e, e.id in sourcees or not sourcees):
            compte[a["type"]] = compte.get(a["type"], 0) + 1
            if (type is None or a["type"] == type) and len(lignes) < limite:
                lignes.append({"entreprise_id": e.id, "raison_sociale": e.raison_sociale, **a})
    return {"par_type": compte, "items": lignes}


@router.get("/qualite/a-verifier")
def a_verifier(user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict:
    q = filtre_visibilite(db.query(Entreprise), user, P.charger(db)).filter(
        Entreprise.statut == STATUT_ACTIVE, Entreprise.statut_validation == VALIDATION_A_VERIFIER)
    return {"total": q.count(), "items": [item_entreprise(e) for e in q.order_by(Entreprise.score.desc()).limit(500)]}


@router.get("/qualite/echantillon")
def echantillon(taille: int | None = None, graine: str | None = None, user: Utilisateur = Depends(lecteur),
                db: Session = Depends(get_db)) -> dict:
    """Échantillon aléatoire reproductible (même graine → même échantillon) pour contrôle des données."""
    params = P.charger(db)
    n = taille or int(params["echantillon_taille"])
    graine = graine or date.today().strftime("%G-S%V")
    ids = sorted(i for (i,) in filtre_visibilite(db.query(Entreprise.id), user, params).filter(Entreprise.statut == STATUT_ACTIVE))
    choix = random.Random(graine).sample(ids, min(n, len(ids)))
    items = db.query(Entreprise).filter(Entreprise.id.in_(choix)).order_by(Entreprise.id).all()
    return {"graine": graine, "taille": len(items), "items": [item_entreprise(e) for e in items]}


@router.get("/qualite/corrections")
def corrections(entreprise_id: str | None = None, limite: int = 500, user: Utilisateur = Depends(lecteur),
                db: Session = Depends(get_db)) -> list[dict]:
    q = db.query(Correction)
    if user.role == ROLE_FX_SALES:
        mes = [i for (i,) in db.query(Entreprise.id).filter(Entreprise.commercial_id == user.id)]
        q = q.filter(Correction.entreprise_id.in_(mes))
    if entreprise_id:
        q = q.filter(Correction.entreprise_id == entreprise_id.upper())
    return [{"id": c.id, "entreprise_id": c.entreprise_id, "champ": c.champ, "avant": c.avant, "apres": c.apres,
             "auteur": c.auteur, "date": c.date.isoformat() if c.date else None, "motif": c.motif, "origine": c.origine}
            for c in q.order_by(Correction.date.desc()).limit(limite)]


class ValidationIn(BaseModel):
    motif: str | None = None


@router.post("/qualite/{eid}/valider")
def valider(eid: str, data: ValidationIn, user: Utilisateur = Depends(saisie), db: Session = Depends(get_db)) -> dict:
    e = entreprise_ou_404(db, eid, user, ecriture=True)
    try:
        corriger(db, e, "statut_validation", "Validée", user.login, data.motif or "Fiche contrôlée")
    except CorrectionInvalide as exc:
        raise HTTPException(422, str(exc))
    db.flush()
    recalculer(db, [e.id])
    db.commit()
    return item_entreprise(e)


def journal_export(db: Session, vue: str, n: int) -> None:
    journaliser(db, "EXPORT", vue, "-", None, {"lignes": n})
    db.commit()


__all__ = ["router", "anomalies_entreprise", "journal_export", "ROLE_RESPONSABLE"]
