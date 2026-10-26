"""Services métier partagés : recalcul score/vague, texte de recherche, droits d'accès."""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Query, Session

from . import parametres as P
from .models import (
    ROLE_FX_SALES,
    STATUT_ACTIVE,
    Entreprise,
    Interaction,
    Qualification,
    Segment,
    Taille,
    Utilisateur,
)
from .scoring import EntreeScore, calculer_score, calculer_vague
from .utils import chiffres, normaliser

# Champs d'identité modifiables (correction tracée) — NAEMA et RCCM sont deux champs distincts.
CHAMPS_IDENTITE = [
    "raison_sociale", "sigle", "ninea", "rccm", "naema_code", "naema_libelle", "activite", "forme_juridique",
    "adresse", "ville", "region", "telephone", "telephone2", "email", "site_web", "contact_nom",
    "contact_fonction", "segment", "taille", "effectif", "chiffre_affaires", "capital", "import_hyp",
    "export_hyp", "statut_validation",
]


def texte_recherche(e: Entreprise) -> str:
    parts = [e.id, e.raison_sociale, e.sigle, e.ninea, e.rccm, e.ville, e.contact_nom,
             chiffres(e.telephone), chiffres(e.telephone2), chiffres(e.ninea), e.email]
    return " ".join(normaliser(p) for p in parts if p)


def _qualif_dict(q: Qualification | None) -> dict | None:
    if q is None:
        return None
    return {
        "import_confirme": q.import_confirme, "export_confirme": q.export_confirme,
        "volume_annuel_fcfa": q.volume_annuel_fcfa, "frequence": q.frequence,
        "besoin_confirme": q.besoin_confirme, "produits": q.produits or [], "potentiel": q.potentiel,
    }


def _seg_dict(s: Segment | None) -> dict:
    if s is None:
        return {}
    return {k: getattr(s, k) for k in ("import_pts", "export_pts", "intensite_pts", "frequence_pts",
                                        "couverture_pts", "potentiel_pts", "vague_defaut")}


def _taille_dict(t: Taille | None) -> dict:
    if t is None:
        return {}
    return {k: getattr(t, k) for k in ("intensite_pts", "frequence_pts", "potentiel_pts")}


def recalculer(db: Session, ids: Iterable[str] | None = None, params: dict | None = None) -> int:
    """Recalcule score, catégorie et vague. `ids=None` : toute la base."""
    params = params or P.charger(db)
    segments = {s.nom: s for s in db.query(Segment).all()}
    tailles = {t.nom: t for t in db.query(Taille).all()}
    q = db.query(Entreprise)
    id_list = list(ids) if ids is not None else None
    if id_list is not None:
        if not id_list:
            return 0
        q = q.filter(Entreprise.id.in_(id_list))
    entreprises = q.all()
    eids = [e.id for e in entreprises]
    if id_list is not None:
        quals = {x.entreprise_id: x for x in db.query(Qualification).filter(Qualification.entreprise_id.in_(eids))}
        dj = set(db.scalars(select(Interaction.entreprise_id).where(
            Interaction.decideur_joint.is_(True), Interaction.entreprise_id.in_(eids)).distinct()))
    else:
        quals = {x.entreprise_id: x for x in db.query(Qualification)}
        dj = set(db.scalars(select(Interaction.entreprise_id).where(Interaction.decideur_joint.is_(True)).distinct()))
    rows = []
    for e in entreprises:
        seg = segments.get(e.segment or "")
        res = calculer_score(EntreeScore(
            segment=e.segment, taille=e.taille, import_hyp=e.import_hyp, export_hyp=e.export_hyp,
            telephone=e.telephone or e.telephone2, email=e.email, contact_nom=e.contact_nom,
            decideur_joint=e.id in dj, qualification=_qualif_dict(quals.get(e.id)),
            segment_pts=_seg_dict(seg), taille_pts=_taille_dict(tailles.get(e.taille or "")),
        ), params)
        vague, regle = calculer_vague(segment=e.segment, categorie_=res["categorie"], taille=e.taille,
                                      vague_manuelle=e.vague_manuelle,
                                      vague_segment=seg.vague_defaut if seg else None, params=params)
        rows.append({"id": e.id, "score": res["score"], "categorie": res["categorie"],
                     "score_detail": res["criteres"], "vague": vague, "vague_regle": regle,
                     "recherche": texte_recherche(e)})
    if rows:
        # Mise à jour en masse des seuls champs dérivés (exclus de l'audit par conception).
        db.execute(update(Entreprise), rows, execution_options={"synchronize_session": False})
        for e in entreprises:
            db.expire(e, ["score", "categorie", "score_detail", "vague", "vague_regle", "recherche"])
    return len(rows)


# --- Droits d'accès ---------------------------------------------------------------

def filtre_visibilite(query: Query, user: Utilisateur, params: dict | None = None, ecriture: bool = False) -> Query:
    """Restreint une requête sur Entreprise selon le rôle.

    FX Sales : ses entreprises (et, en lecture seule, toute la base si le paramètre
    `fx_sales_voit_toute_base` est activé). Responsable et Lecture seule : tout.
    """
    if user.role == ROLE_FX_SALES:
        voit_tout = (params or {}).get("fx_sales_voit_toute_base", False)
        if ecriture or not voit_tout:
            return query.filter(Entreprise.commercial_id == user.id)
    return query


def peut_voir(user: Utilisateur, e: Entreprise, params: dict) -> bool:
    if user.role != ROLE_FX_SALES:
        return True
    return e.commercial_id == user.id or bool(params.get("fx_sales_voit_toute_base"))


def peut_modifier(user: Utilisateur, e: Entreprise) -> bool:
    from .models import ROLE_RESPONSABLE

    if user.role == ROLE_RESPONSABLE:
        return True
    return user.role == ROLE_FX_SALES and e.commercial_id == user.id


def entreprises_actives(db: Session):
    return db.query(Entreprise).filter(Entreprise.statut == STATUT_ACTIVE)


def resoudre_alias(alias: dict[str, str], eid: str | None) -> str | None:
    """Suit la chaîne d'alias ancien → nouveau (détecte les cycles)."""
    if not eid:
        return eid
    vus = set()
    while eid in alias and eid not in vus:
        vus.add(eid)
        eid = alias[eid]
    return eid


def recherche_filtre(query: Query, texte: str) -> Query:
    termes = normaliser(texte).split()
    for t in termes:
        d = chiffres(t)
        conds = [Entreprise.recherche.like(f"%{t}%")]
        if d and len(d) >= 4 and d != t:
            conds.append(Entreprise.recherche.like(f"%{d}%"))
        query = query.filter(or_(*conds))
    return query
