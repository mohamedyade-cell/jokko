"""Call Tracker, Agenda, Qualification FX et Pipeline."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import parametres as P
from ..db import get_db
from ..models import (
    PRODUITS_FX,
    ROLE_FX_SALES,
    ROLE_RESPONSABLE,
    STATUT_ACTIVE,
    TYPES_INTERACTION,
    Entreprise,
    Interaction,
    Opportunite,
    Qualification,
    Utilisateur,
)
from ..security import lecteur, saisie
from ..services import filtre_visibilite, recalculer
from .commun import entreprise_ou_404
from .entreprises import _interaction, _opportunite, _qualification

router = APIRouter(prefix="/api", tags=["Activité commerciale"])


# --- Call Tracker -------------------------------------------------------------------------

class InteractionIn(BaseModel):
    entreprise_id: str
    date: date
    type: str = "Appel"
    tentative: int = Field(1, ge=1, le=99)
    joint: bool = False
    decideur_joint: bool = False
    rdv_obtenu: bool = False
    date_rdv: date | None = None
    resultat: str | None = None
    commentaire: str | None = None
    prochaine_action: str | None = None
    date_prochaine_action: date | None = None


def _valider_interaction(data: InteractionIn) -> None:
    if data.type not in TYPES_INTERACTION:
        raise HTTPException(422, f"Type attendu : {', '.join(TYPES_INTERACTION)}")
    if data.decideur_joint and not data.joint:
        raise HTTPException(422, "Un décideur joint implique que l'entreprise a été jointe")
    if data.rdv_obtenu and not data.date_rdv and data.type not in ("RDV", "Visite"):
        raise HTTPException(422, "Indiquez la date du RDV obtenu")
    if data.date > date.today() + timedelta(days=1):
        raise HTTPException(422, "La date de l'interaction ne peut pas être dans le futur")
    if data.prochaine_action and not data.date_prochaine_action:
        raise HTTPException(422, "Indiquez la date de la prochaine action")


def _interaction_modifiable(db: Session, iid: int, user: Utilisateur) -> Interaction:
    i = db.get(Interaction, iid)
    if i is None:
        raise HTTPException(404, "Interaction introuvable")
    if user.role != ROLE_RESPONSABLE and i.commercial_id != user.id:
        raise HTTPException(403, "Vous ne pouvez modifier que vos propres saisies")
    return i


@router.get("/interactions")
def lister_interactions(entreprise_id: str | None = None, commercial_id: int | None = None, du: date | None = None,
                        au: date | None = None, limite: int = 500, user: Utilisateur = Depends(lecteur),
                        db: Session = Depends(get_db)) -> list[dict]:
    q = db.query(Interaction).join(Entreprise, Entreprise.id == Interaction.entreprise_id)
    q = filtre_visibilite(q, user, P.charger(db))
    if entreprise_id:
        q = q.filter(Interaction.entreprise_id == entreprise_id.upper())
    if commercial_id:
        q = q.filter(Interaction.commercial_id == commercial_id)
    if du:
        q = q.filter(Interaction.date >= du)
    if au:
        q = q.filter(Interaction.date <= au)
    rows = q.order_by(Interaction.date.desc(), Interaction.id.desc()).limit(min(limite, 5000)).all()
    noms = dict(db.query(Entreprise.id, Entreprise.raison_sociale).filter(Entreprise.id.in_({i.entreprise_id for i in rows})))
    return [{**_interaction(i), "raison_sociale": noms.get(i.entreprise_id)} for i in rows]


@router.post("/interactions", status_code=201)
def creer_interaction(data: InteractionIn, user: Utilisateur = Depends(saisie), db: Session = Depends(get_db)) -> dict:
    _valider_interaction(data)
    e = entreprise_ou_404(db, data.entreprise_id, user, ecriture=True)
    # La nouvelle interaction solde les relances encore ouvertes sur l'entreprise.
    for ancienne in db.query(Interaction).filter(Interaction.entreprise_id == e.id, Interaction.action_faite.is_(False),
                                                Interaction.date_prochaine_action.isnot(None)):
        ancienne.action_faite = True
    i = Interaction(**{**data.model_dump(), "entreprise_id": e.id},
                    commercial_id=user.id if user.role == ROLE_FX_SALES else (e.commercial_id or user.id),
                    cree_par=user.login)
    db.add(i)
    db.flush()
    recalculer(db, [e.id])
    db.commit()
    return {**_interaction(i), "score": e.score, "categorie": e.categorie}


@router.put("/interactions/{iid}")
def modifier_interaction(iid: int, data: InteractionIn, user: Utilisateur = Depends(saisie), db: Session = Depends(get_db)) -> dict:
    _valider_interaction(data)
    i = _interaction_modifiable(db, iid, user)
    if data.entreprise_id.upper() != i.entreprise_id:
        raise HTTPException(422, "L'entreprise d'une interaction ne peut pas être changée")
    for k, v in data.model_dump(exclude={"entreprise_id"}).items():
        setattr(i, k, v)
    db.flush()
    recalculer(db, [i.entreprise_id])
    db.commit()
    return _interaction(i)


@router.post("/interactions/{iid}/fait")
def action_faite(iid: int, user: Utilisateur = Depends(saisie), db: Session = Depends(get_db)) -> dict:
    i = _interaction_modifiable(db, iid, user)
    i.action_faite = True
    db.commit()
    return _interaction(i)


@router.delete("/interactions/{iid}")
def supprimer_interaction(iid: int, user: Utilisateur = Depends(saisie), db: Session = Depends(get_db)) -> dict:
    i = _interaction_modifiable(db, iid, user)
    eid = i.entreprise_id
    db.delete(i)
    db.flush()
    recalculer(db, [eid])
    db.commit()
    return {"ok": True}


# --- Agenda --------------------------------------------------------------------------------

@router.get("/agenda")
def agenda(commercial_id: int | None = None, jours: int = 14, aujourdhui: date | None = None, limite: int = 300,
           user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict:
    today = aujourdhui or date.today()
    if user.role == ROLE_FX_SALES:
        commercial_id = user.id
    q = (db.query(Interaction, Entreprise).join(Entreprise, Entreprise.id == Interaction.entreprise_id)
         .filter(Entreprise.statut == STATUT_ACTIVE))
    if commercial_id:
        q = q.filter((Interaction.commercial_id == commercial_id) | (Entreprise.commercial_id == commercial_id))
    horizon = today + timedelta(days=jours)
    relances = q.filter(Interaction.action_faite.is_(False), Interaction.date_prochaine_action.isnot(None),
                        Interaction.date_prochaine_action <= horizon).order_by(Interaction.date_prochaine_action).all()
    rdv = q.filter(Interaction.date_rdv.isnot(None), Interaction.date_rdv >= today,
                   Interaction.date_rdv <= horizon).order_by(Interaction.date_rdv).all()

    def ligne(i: Interaction, e: Entreprise) -> dict:
        return {**_interaction(i), "raison_sociale": e.raison_sociale, "telephone": e.telephone, "categorie": e.categorie,
                "score": e.score, "commercial_entreprise": e.commercial.nom if e.commercial else None}

    rubriques = {
        "en_retard": [(i, e) for i, e in relances if i.date_prochaine_action < today],
        "aujourdhui": [(i, e) for i, e in relances if i.date_prochaine_action == today],
        "a_venir": [(i, e) for i, e in relances if i.date_prochaine_action > today],
        "rdv": rdv,
    }
    # Listes plafonnées (les plus urgentes d'abord) ; les totaux restent exacts.
    out = {"date": today.isoformat(), "totaux": {k: len(v) for k, v in rubriques.items()}}
    for k, v in rubriques.items():
        out[k] = [ligne(i, e) for i, e in (v[-limite:][::-1] if k == "en_retard" else v[:limite])]
    return out


# --- Qualification FX ------------------------------------------------------------------------

class QualificationIn(BaseModel):
    devises: list[str] = []
    volume_annuel_fcfa: float | None = Field(None, ge=0)
    frequence: str | None = None
    banque_actuelle: str | None = None
    besoin_confirme: bool | None = None
    produits: list[str] = []
    import_confirme: bool | None = None
    export_confirme: bool | None = None
    potentiel: str | None = None
    qualifiee: bool = False
    date_qualification: date | None = None
    commentaire: str | None = None


@router.get("/entreprises/{eid}/qualification")
def lire_qualification(eid: str, user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict | None:
    e = entreprise_ou_404(db, eid, user)
    return _qualification(db.get(Qualification, e.id))


@router.put("/entreprises/{eid}/qualification")
def enregistrer_qualification(eid: str, data: QualificationIn, user: Utilisateur = Depends(saisie),
                              db: Session = Depends(get_db)) -> dict:
    e = entreprise_ou_404(db, eid, user, ecriture=True)
    params = P.charger(db)
    if data.frequence and data.frequence not in params["frequence_points"]:
        raise HTTPException(422, f"Fréquence attendue : {', '.join(params['frequence_points'])}")
    if data.potentiel and data.potentiel not in params["potentiel_points"]:
        raise HTTPException(422, f"Potentiel attendu : {', '.join(params['potentiel_points'])}")
    if set(data.produits) - set(PRODUITS_FX):
        raise HTTPException(422, f"Produits attendus : {', '.join(PRODUITS_FX)}")
    valeurs = data.model_dump()
    valeurs["devises"] = [d.upper() for d in valeurs["devises"]]
    if valeurs["qualifiee"] and not valeurs["date_qualification"]:
        valeurs["date_qualification"] = date.today()
    q = db.get(Qualification, e.id)
    if q is None:
        q = Qualification(entreprise_id=e.id, **valeurs, modifie_par=user.login)
        db.add(q)
    else:
        for k, v in valeurs.items():
            setattr(q, k, v)
        q.modifie_par = user.login
    db.flush()
    recalculer(db, [e.id])
    db.commit()
    return {"qualification": _qualification(q), "score": e.score, "categorie": e.categorie, "vague": e.vague,
            "score_detail": e.score_detail}


# --- Pipeline -----------------------------------------------------------------------------------

class OpportuniteIn(BaseModel):
    entreprise_id: str
    intitule: str | None = None
    produit: str | None = None
    etape: str
    montant: float | None = Field(None, ge=0)
    devise: str = "XOF"
    marge_pb: float | None = Field(None, ge=0, le=10000)
    probabilite: int | None = Field(None, ge=0, le=100)
    date_ouverture: date | None = None
    date_cloture_prevue: date | None = None
    date_cloture: date | None = None
    commentaire: str | None = None


def _valider_opp(data: OpportuniteIn, params: dict) -> dict:
    etapes = {e["nom"]: e for e in params["etapes_pipeline"]}
    if data.etape not in etapes:
        raise HTTPException(422, "Étape inconnue")
    if data.devise.upper() not in params["taux_change"]:
        raise HTTPException(422, f"Devise sans taux de conversion : {data.devise}")
    v = data.model_dump()
    v["devise"] = v["devise"].upper()
    if v["probabilite"] is None:
        v["probabilite"] = etapes[data.etape].get("probabilite")
    if v["marge_pb"] is None:
        v["marge_pb"] = params["marge_pb_defaut"]
    if v["date_ouverture"] is None:
        v["date_ouverture"] = date.today()
    if (etapes[data.etape].get("gagnee") or etapes[data.etape].get("perdue")) and not v["date_cloture"]:
        v["date_cloture"] = date.today()
    return v


def _opp_modifiable(db: Session, oid: int, user: Utilisateur) -> Opportunite:
    o = db.get(Opportunite, oid)
    if o is None:
        raise HTTPException(404, "Opportunité introuvable")
    entreprise_ou_404(db, o.entreprise_id, user, ecriture=True)
    return o


def _maj_cliente(db: Session, o: Opportunite, params: dict) -> None:
    if o.etape == P.etape_gagnee(params):
        db.get(Entreprise, o.entreprise_id).est_cliente = True


@router.get("/opportunites")
def lister_opportunites(commercial_id: int | None = None, etape: str | None = None, user: Utilisateur = Depends(lecteur),
                        db: Session = Depends(get_db)) -> list[dict]:
    params = P.charger(db)
    q = filtre_visibilite(db.query(Opportunite, Entreprise).join(Entreprise, Entreprise.id == Opportunite.entreprise_id), user, params)
    if commercial_id:
        q = q.filter(Entreprise.commercial_id == commercial_id)
    if etape:
        q = q.filter(Opportunite.etape == etape)
    return [{**_opportunite(o, params), "raison_sociale": e.raison_sociale, "categorie": e.categorie}
            for o, e in q.order_by(Opportunite.date_cloture_prevue.is_(None), Opportunite.date_cloture_prevue).all()]


@router.get("/pipeline/kanban")
def kanban(commercial_id: int | None = None, user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict:
    params = P.charger(db)
    opps = lister_opportunites(commercial_id=commercial_id, user=user, db=db)
    colonnes = []
    noms = [e["nom"] for e in params["etapes_pipeline"]]
    for e in params["etapes_pipeline"]:
        items = [o for o in opps if o["etape"] == e["nom"]]
        colonnes.append({"etape": e["nom"], "probabilite": e.get("probabilite"), "nb": len(items),
                         "montant_fcfa": sum(o["montant_fcfa"] for o in items),
                         "pondere_fcfa": round(sum(o["montant_fcfa"] * (o["probabilite"] or 0) / 100 for o in items)),
                         "pnb_fcfa": sum(o["pnb_estime_fcfa"] for o in items), "items": items})
    hors = [o for o in opps if o["etape"] not in noms]
    if hors:
        colonnes.append({"etape": "Étape inconnue", "probabilite": None, "nb": len(hors),
                         "montant_fcfa": sum(o["montant_fcfa"] for o in hors), "pondere_fcfa": 0, "pnb_fcfa": 0, "items": hors})
    return {"colonnes": colonnes, "etapes": params["etapes_pipeline"], "devises": list(params["taux_change"])}


@router.post("/opportunites", status_code=201)
def creer_opportunite(data: OpportuniteIn, user: Utilisateur = Depends(saisie), db: Session = Depends(get_db)) -> dict:
    params = P.charger(db)
    e = entreprise_ou_404(db, data.entreprise_id, user, ecriture=True)
    v = _valider_opp(data, params)
    v["entreprise_id"] = e.id
    o = Opportunite(**v, commercial_id=e.commercial_id or user.id, cree_par=user.login)
    db.add(o)
    _maj_cliente(db, o, params)
    db.commit()
    return _opportunite(o, params)


@router.put("/opportunites/{oid}")
def modifier_opportunite(oid: int, data: OpportuniteIn, user: Utilisateur = Depends(saisie), db: Session = Depends(get_db)) -> dict:
    params = P.charger(db)
    o = _opp_modifiable(db, oid, user)
    v = _valider_opp(data, params)
    v.pop("entreprise_id")
    for k, val in v.items():
        setattr(o, k, val)
    _maj_cliente(db, o, params)
    db.commit()
    return _opportunite(o, params)


class EtapeIn(BaseModel):
    etape: str


@router.post("/opportunites/{oid}/etape")
def deplacer(oid: int, data: EtapeIn, user: Utilisateur = Depends(saisie), db: Session = Depends(get_db)) -> dict:
    params = P.charger(db)
    o = _opp_modifiable(db, oid, user)
    etapes = {e["nom"]: e for e in params["etapes_pipeline"]}
    if data.etape not in etapes:
        raise HTTPException(422, "Étape inconnue")
    o.etape = data.etape
    o.probabilite = etapes[data.etape].get("probabilite", o.probabilite)
    if etapes[data.etape].get("gagnee") or etapes[data.etape].get("perdue"):
        o.date_cloture = o.date_cloture or date.today()
    _maj_cliente(db, o, params)
    db.commit()
    return _opportunite(o, params)


@router.delete("/opportunites/{oid}")
def supprimer_opportunite(oid: int, user: Utilisateur = Depends(saisie), db: Session = Depends(get_db)) -> dict:
    o = _opp_modifiable(db, oid, user)
    db.delete(o)
    db.commit()
    return {"ok": True}
