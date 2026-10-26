"""Fonctions partagées par les routeurs : accès, sérialisation, filtres."""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import exists, select
from sqlalchemy.orm import Query, Session

from .. import parametres as P
from ..models import (
    STATUT_ACTIVE,
    Entreprise,
    Interaction,
    Opportunite,
    Utilisateur,
)
from ..services import filtre_visibilite, peut_modifier, peut_voir, recherche_filtre


def entreprise_ou_404(db: Session, eid: str, user: Utilisateur, ecriture: bool = False) -> Entreprise:
    e = db.get(Entreprise, eid.upper())
    if e is None:
        raise HTTPException(404, f"Entreprise {eid} introuvable")
    params = P.charger(db)
    if not peut_voir(user, e, params):
        raise HTTPException(403, "Cette entreprise n'est pas dans votre portefeuille")
    if ecriture and not peut_modifier(user, e):
        raise HTTPException(403, "Modification réservée au commercial attributaire ou au Responsable")
    if ecriture and e.statut != STATUT_ACTIVE:
        raise HTTPException(409, f"Entreprise fusionnée dans {e.fusionnee_vers} : saisissez sur l'ID principal")
    return e


def item_entreprise(e: Entreprise) -> dict:
    return {
        "id": e.id, "raison_sociale": e.raison_sociale, "sigle": e.sigle, "ninea": e.ninea, "rccm": e.rccm,
        "naema_code": e.naema_code, "telephone": e.telephone, "ville": e.ville, "region": e.region,
        "segment": e.segment, "taille": e.taille, "score": e.score, "categorie": e.categorie, "vague": e.vague,
        "statut_validation": e.statut_validation, "commercial_id": e.commercial_id,
        "commercial": e.commercial.nom if e.commercial else None, "statut": e.statut, "fictif": e.fictif,
        "est_cliente": e.est_cliente,
    }


STATUTS_COMMERCIAUX = {
    "non_contactee": "Non contactée", "contactee": "Contactée", "jointe": "Jointe", "decideur": "Décideur joint",
    "rdv": "RDV obtenu", "opportunite": "Avec opportunité", "cliente": "Cliente",
}


def filtrer_entreprises(db: Session, user: Utilisateur, *, q: str | None = None, segment: str | None = None,
                        categorie: str | None = None, vague: int | None = None, taille: str | None = None,
                        region: str | None = None, commercial_id: int | None = None, statut: str | None = None,
                        statut_validation: str | None = None, non_attribuees: bool = False,
                        inclure_fusionnees: bool = False) -> Query:
    params = P.charger(db)
    query = filtre_visibilite(db.query(Entreprise), user, params)
    if not inclure_fusionnees:
        query = query.filter(Entreprise.statut == STATUT_ACTIVE)
    if q:
        query = recherche_filtre(query, q)
    if segment:
        query = query.filter(Entreprise.segment == segment)
    if categorie:
        query = query.filter(Entreprise.categorie.in_(categorie.split(",")))
    if vague is not None:
        query = query.filter(Entreprise.vague == vague)
    if taille:
        query = query.filter(Entreprise.taille == taille)
    if region:
        query = query.filter(Entreprise.region == region)
    if commercial_id is not None:
        query = query.filter(Entreprise.commercial_id == commercial_id)
    if non_attribuees:
        query = query.filter(Entreprise.commercial_id.is_(None))
    if statut_validation:
        query = query.filter(Entreprise.statut_validation == statut_validation)
    if statut:
        i = select(Interaction.id).where(Interaction.entreprise_id == Entreprise.id)
        o = select(Opportunite.id).where(Opportunite.entreprise_id == Entreprise.id)
        if statut == "non_contactee":
            query = query.filter(~exists(i))
        elif statut == "contactee":
            query = query.filter(exists(i))
        elif statut == "jointe":
            query = query.filter(exists(i.where(Interaction.joint.is_(True))))
        elif statut == "decideur":
            query = query.filter(exists(i.where(Interaction.decideur_joint.is_(True))))
        elif statut == "rdv":
            query = query.filter(exists(i.where((Interaction.rdv_obtenu.is_(True)) | Interaction.type.in_(("RDV", "Visite")))))
        elif statut == "opportunite":
            query = query.filter(exists(o))
        elif statut == "cliente":
            query = query.filter((Entreprise.est_cliente.is_(True)) | exists(o.where(Opportunite.etape == P.etape_gagnee(params))))
        else:
            raise HTTPException(422, f"Statut inconnu : {statut}")
    return query


TRIS = {
    "score": Entreprise.score.desc(), "-score": Entreprise.score.asc(), "nom": Entreprise.raison_sociale.asc(),
    "id": Entreprise.id.asc(), "vague": Entreprise.vague.asc(), "categorie": Entreprise.categorie.asc(),
}


def iso(d: date | None) -> str | None:
    return d.isoformat() if d else None
