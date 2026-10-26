"""Base entreprises, fiche 360°, provenance des champs (PDF + page)."""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import parametres as P
from ..config import get_settings
from ..corrections import CorrectionInvalide, corriger, verrouiller
from ..db import get_db
from ..models import (
    ROLE_RESPONSABLE,
    Correction,
    Entreprise,
    EntiteAlias,
    Fiche,
    FichierPdf,
    Interaction,
    Opportunite,
    ProvenanceChamp,
    Qualification,
    Segment,
    Utilisateur,
)
from ..scoring import PLAFONDS
from ..security import lecteur, saisie
from ..services import CHAMPS_IDENTITE, recalculer
from .commun import STATUTS_COMMERCIAUX, TRIS, entreprise_ou_404, filtrer_entreprises, iso, item_entreprise

router = APIRouter(prefix="/api", tags=["Base entreprises"])

LIBELLES_CHAMPS = {
    "raison_sociale": "Raison sociale", "sigle": "Sigle", "ninea": "NINEA", "rccm": "RCCM",
    "naema_code": "Code NAEMA (NAF)", "naema_libelle": "Libellé NAEMA", "activite": "Activité",
    "forme_juridique": "Forme juridique", "adresse": "Adresse", "ville": "Ville", "region": "Région",
    "telephone": "Téléphone", "telephone2": "Téléphone 2", "email": "E-mail", "site_web": "Site web",
    "contact_nom": "Contact / dirigeant", "contact_fonction": "Fonction", "segment": "Segment", "taille": "Taille",
    "effectif": "Effectif", "chiffre_affaires": "Chiffre d'affaires (FCFA)", "capital": "Capital (FCFA)",
    "import_hyp": "Import (hypothèse)", "export_hyp": "Export (hypothèse)", "statut_validation": "Statut de validation",
}


@router.get("/entreprises")
def lister(
    q: str | None = None, segment: str | None = None, categorie: str | None = None, vague: int | None = None,
    taille: str | None = None, region: str | None = None, commercial_id: int | None = None,
    statut: str | None = None, statut_validation: str | None = None, non_attribuees: bool = False,
    inclure_fusionnees: bool = False, tri: str = "score", page: int = Query(1, ge=1),
    taille_page: int = Query(50, ge=1, le=500),
    user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db),
) -> dict:
    query = filtrer_entreprises(db, user, q=q, segment=segment, categorie=categorie, vague=vague, taille=taille,
                                region=region, commercial_id=commercial_id, statut=statut,
                                statut_validation=statut_validation, non_attribuees=non_attribuees,
                                inclure_fusionnees=inclure_fusionnees)
    total = query.order_by(None).count()
    items = query.order_by(TRIS.get(tri, TRIS["score"]), Entreprise.id).offset((page - 1) * taille_page).limit(taille_page).all()
    return {"total": total, "page": page, "taille_page": taille_page, "items": [item_entreprise(e) for e in items]}


@router.get("/entreprises-filtres")
def filtres(user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict:
    def distincts(col):
        return [v for (v,) in db.query(col).filter(col.isnot(None)).distinct().order_by(col)]
    return {
        "segments": distincts(Entreprise.segment), "tailles": distincts(Entreprise.taille),
        "regions": distincts(Entreprise.region), "vagues": distincts(Entreprise.vague),
        "categories": ["A", "B", "C", "D"], "statuts": STATUTS_COMMERCIAUX,
        "statuts_validation": ["Validée", "À vérifier"],
        "commerciaux": [{"id": u.id, "nom": u.nom, "role": u.role} for u in
                        db.query(Utilisateur).filter(Utilisateur.actif.is_(True)).order_by(Utilisateur.nom)],
    }


def _provenances(db: Session, eid: str) -> dict[str, dict]:
    fichiers = {f.id: f for f in db.query(FichierPdf)}
    out = {}
    for p in db.query(ProvenanceChamp).filter(ProvenanceChamp.entreprise_id == eid):
        f = fichiers.get(p.fichier_id)
        out[p.champ] = {"fiche_id": p.fiche_id, "fichier_id": p.fichier_id, "fichier": f.nom if f else None,
                        "page": p.page, "exacte": p.exacte,
                        "url_page": f"/api/sources/fichiers/{p.fichier_id}/page/{p.page}" if p.fichier_id and p.page else None,
                        "url_pdf": f"/api/sources/fichiers/{p.fichier_id}/pdf#page={p.page or 1}" if p.fichier_id else None}
    return out


def _interaction(i: Interaction) -> dict:
    return {"id": i.id, "entreprise_id": i.entreprise_id, "date": iso(i.date), "type": i.type, "tentative": i.tentative,
            "joint": i.joint, "decideur_joint": i.decideur_joint, "rdv_obtenu": i.rdv_obtenu, "date_rdv": iso(i.date_rdv),
            "resultat": i.resultat, "commentaire": i.commentaire, "prochaine_action": i.prochaine_action,
            "date_prochaine_action": iso(i.date_prochaine_action), "action_faite": i.action_faite,
            "commercial_id": i.commercial_id, "commercial": i.commercial.nom if i.commercial else None, "cree_par": i.cree_par}


def _qualification(q: Qualification | None) -> dict | None:
    if q is None:
        return None
    return {k: (iso(v) if isinstance(v, date) else v) for k, v in
            ((c.key, getattr(q, c.key)) for c in Qualification.__table__.columns) if k not in {"import_key", "modifie_le"}}


def _opportunite(o: Opportunite, params: dict) -> dict:
    fcfa = (o.montant or 0) * P.taux_fcfa(params, o.devise)
    marge = o.marge_pb if o.marge_pb is not None else params["marge_pb_defaut"]
    return {"id": o.id, "entreprise_id": o.entreprise_id, "intitule": o.intitule, "produit": o.produit, "etape": o.etape,
            "montant": o.montant, "devise": o.devise, "montant_fcfa": round(fcfa), "marge_pb": o.marge_pb,
            "pnb_estime_fcfa": round(fcfa * marge / 10000), "probabilite": o.probabilite,
            "date_ouverture": iso(o.date_ouverture), "date_cloture_prevue": iso(o.date_cloture_prevue),
            "date_cloture": iso(o.date_cloture), "commentaire": o.commentaire, "commercial_id": o.commercial_id,
            "commercial": o.commercial.nom if o.commercial else None}


@router.get("/entreprises/{eid}")
def fiche_360(eid: str, user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict:
    e = db.get(Entreprise, eid.upper())
    if e is None:
        alias = db.get(EntiteAlias, eid.upper())
        if alias:
            return {"redirection": alias.nouvel_id}
    e = entreprise_ou_404(db, eid, user)
    params = P.charger(db)
    seg = db.get(Segment, e.segment) if e.segment else None
    interactions = db.query(Interaction).filter(Interaction.entreprise_id == e.id).order_by(Interaction.date.desc(), Interaction.id.desc()).all()
    prochaine = next((i for i in sorted(interactions, key=lambda x: (x.date_prochaine_action or date.max))
                      if i.date_prochaine_action and not i.action_faite), None)
    provs = _provenances(db, e.id)
    identite = []
    for champ in CHAMPS_IDENTITE:
        v = getattr(e, champ)
        identite.append({"champ": champ, "libelle": LIBELLES_CHAMPS.get(champ, champ),
                         "valeur": ("Oui" if v else "Non") if isinstance(v, bool) else v,
                         "source": provs.get(champ), "corrige": champ in (e.champs_verrouilles or [])})
    fiches = (db.query(Fiche, FichierPdf).outerjoin(FichierPdf, Fiche.fichier_id == FichierPdf.id)
              .filter(Fiche.entreprise_id == e.id).order_by(Fiche.id).all())
    return {
        **item_entreprise(e),
        "identite": identite,
        "score_detail": [{"cle": k, **v} for k, v in (e.score_detail or {}).items()],
        "plafonds": PLAFONDS,
        "seuils": {"A": params["seuil_A"], "B": params["seuil_B"], "C": params["seuil_C"]},
        "vague_regle": e.vague_regle, "vague_manuelle": e.vague_manuelle,
        "accroche": seg.accroche if seg else None,
        "interactions": [_interaction(i) for i in interactions],
        "qualification": _qualification(db.get(Qualification, e.id)),
        "opportunites": [_opportunite(o, params) for o in db.query(Opportunite).filter(Opportunite.entreprise_id == e.id).order_by(Opportunite.id)],
        "prochaine_action": _interaction(prochaine) if prochaine else None,
        "corrections": [{"id": c.id, "champ": c.champ, "avant": c.avant, "apres": c.apres, "auteur": c.auteur,
                         "date": c.date.isoformat() if c.date else None, "motif": c.motif, "origine": c.origine}
                        for c in db.query(Correction).filter(Correction.entreprise_id == e.id).order_by(Correction.date.desc())],
        "anciens_ids": [a.ancien_id for a in db.query(EntiteAlias).filter(EntiteAlias.nouvel_id == e.id)],
        "fusionnee_vers": e.fusionnee_vers,
        "fiches_sources": [{"fiche_id": f.id, "fichier": fp.nom if fp else None, "fichier_id": f.fichier_id, "page": f.page,
                            "url_page": f"/api/sources/fichiers/{f.fichier_id}/page/{f.page}" if f.fichier_id and f.page else None,
                            "url_pdf": f"/api/sources/fichiers/{f.fichier_id}/pdf#page={f.page or 1}" if f.fichier_id else None}
                           for f, fp in fiches],
        "nb_fiches": e.nb_fiches,
        "peut_modifier": user.role == ROLE_RESPONSABLE or (user.role == "fx_sales" and e.commercial_id == user.id),
        "absente_dernier_import": e.absente_dernier_import,
    }


class CorrectionIn(BaseModel):
    champ: str
    valeur: Any = None
    motif: str | None = None


@router.post("/entreprises/{eid}/corrections")
def corriger_champ(eid: str, data: CorrectionIn, user: Utilisateur = Depends(saisie), db: Session = Depends(get_db)) -> dict:
    e = entreprise_ou_404(db, eid, user, ecriture=True)
    try:
        c = corriger(db, e, data.champ, data.valeur, user.login, data.motif)
    except CorrectionInvalide as exc:
        raise HTTPException(422, str(exc))
    db.flush()
    recalculer(db, [e.id])
    db.commit()
    return {"ok": True, "correction_id": c.id if c else None, "score": e.score, "categorie": e.categorie, "vague": e.vague}


class PilotageIn(BaseModel):
    vague_manuelle: int | None = None
    commercial_id: int | None = None
    est_cliente: bool | None = None
    champs: list[str] = []  # champs à mettre à jour (permet de remettre une valeur à vide)


@router.patch("/entreprises/{eid}")
def piloter(eid: str, data: PilotageIn, user: Utilisateur = Depends(saisie), db: Session = Depends(get_db)) -> dict:
    e = entreprise_ou_404(db, eid, user, ecriture=True)
    champs = set(data.champs) or {k for k, v in data.model_dump(exclude={"champs"}).items() if v is not None}
    if champs & {"vague_manuelle", "commercial_id"} and user.role != ROLE_RESPONSABLE:
        raise HTTPException(403, "Vague manuelle et attribution réservées au Responsable")
    if "vague_manuelle" in champs:
        if data.vague_manuelle is not None and not 1 <= data.vague_manuelle <= 9:
            raise HTTPException(422, "Vague entre 1 et 9")
        e.vague_manuelle = data.vague_manuelle
        verrouiller(e, "vague_manuelle")
    if "commercial_id" in champs:
        if data.commercial_id is not None and db.get(Utilisateur, data.commercial_id) is None:
            raise HTTPException(422, "Commercial inconnu")
        e.commercial_id = data.commercial_id
        e.date_attribution = date.today() if data.commercial_id else None
        verrouiller(e, "commercial_id")
    if "est_cliente" in champs:
        e.est_cliente = bool(data.est_cliente)
    db.flush()
    recalculer(db, [e.id])
    db.commit()
    return item_entreprise(e)


# --- Sources PDF -------------------------------------------------------------------------

def _chemin_pdf(db: Session, fichier_id: int) -> Path:
    f = db.get(FichierPdf, fichier_id)
    racine = get_settings().pdf_dir
    if f is None:
        raise HTTPException(404, "Fichier PDF inconnu")
    if racine is None:
        raise HTTPException(404, "Dossier des PDF non configuré (RADAR_PDF_DIR)")
    racine = racine.resolve()
    candidats = [racine / (f.chemin or f.nom), racine / f.nom]
    for c in candidats:
        c = c.resolve()
        # Interdit toute sortie du dossier des PDF (chemin relatif malveillant)
        if c.is_file() and racine in c.parents:
            return c
    raise HTTPException(404, f"PDF « {f.nom} » introuvable dans le dossier configuré")


@router.get("/sources/fichiers/{fichier_id}/pdf")
def pdf(fichier_id: int, user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)):
    return FileResponse(_chemin_pdf(db, fichier_id), media_type="application/pdf")


@router.get("/sources/fichiers/{fichier_id}/page/{page}")
def image_page(fichier_id: int, page: int, user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)):
    chemin = _chemin_pdf(db, fichier_id)
    try:
        import fitz  # PyMuPDF, optionnel
    except ImportError:
        raise HTTPException(501, "Rendu d'image indisponible (PyMuPDF non installé) : ouvrez le PDF à la page indiquée")
    with fitz.open(chemin) as doc:
        if not 1 <= page <= doc.page_count:
            raise HTTPException(404, "Page hors du document")
        png = doc[page - 1].get_pixmap(dpi=110).tobytes("png")
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/stats/fiches")
def stats_fiches(user: Utilisateur = Depends(lecteur), db: Session = Depends(get_db)) -> dict:
    return {"fiches": db.query(func.count(Fiche.id)).scalar(), "fichiers": db.query(func.count(FichierPdf.id)).scalar()}
