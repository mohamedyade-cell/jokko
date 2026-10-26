"""Détection et traitement des doublons.

Règle : jamais de fusion sur le seul nom. Un rapprochement par nom seul est
proposé au niveau « faible » et ne peut être confirmé qu'avec une justification
écrite (vérification humaine d'un identifiant, d'un appel, etc.).
Une fusion ne supprime rien : l'entreprise secondaire passe au statut
« Fusionnée », un alias ancien ID → ID principal est créé et les saisies
(interactions, opportunités, qualification) sont rattachées à l'ID principal.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from itertools import combinations

from sqlalchemy.orm import Session

from .models import (
    DECISION_DISTINCTES,
    DECISION_DOUBLON,
    STATUT_ACTIVE,
    STATUT_FUSIONNEE,
    Entreprise,
    EntiteAlias,
    Interaction,
    Opportunite,
    PaireDoublon,
    Qualification,
)
from .utils import nom_normalise, ninea_normalise, normaliser, rccm_normalise, telephone_normalise

CRITERES_FORTS = {"NINEA identique", "RCCM identique"}
CRITERES_MOYENS = {"Téléphone identique", "E-mail identique"}
CRITERE_NOM = "Nom proche (même ville)"
TAILLE_MAX_GROUPE = 15  # au-delà, valeur générique (ex. standard partagé) : pas de paires générées
JUSTIFICATION_MIN = 15


class DecisionInvalide(ValueError):
    pass


def _niveau(criteres: set[str]) -> str:
    if criteres & CRITERES_FORTS:
        return "fort"
    if criteres & CRITERES_MOYENS:
        return "moyen"
    return "faible"


def detecter(db: Session) -> dict:
    entreprises = db.query(Entreprise).filter(Entreprise.statut == STATUT_ACTIVE).all()
    groupes: dict[tuple[str, str], list[str]] = defaultdict(list)
    for e in entreprises:
        n = ninea_normalise(e.ninea)
        if len(n) >= 7:
            groupes[("NINEA identique", n[:9])].append(e.id)
        r = rccm_normalise(e.rccm)
        if len(r) >= 8:
            groupes[("RCCM identique", r)].append(e.id)
        for tel in {telephone_normalise(e.telephone), telephone_normalise(e.telephone2)}:
            if len(tel) >= 9:
                groupes[("Téléphone identique", tel)].append(e.id)
        if e.email:
            groupes[("E-mail identique", normaliser(e.email))].append(e.id)
        nom = nom_normalise(e.raison_sociale)
        if len(nom) >= 4:
            groupes[(CRITERE_NOM, nom + "|" + normaliser(e.ville))].append(e.id)
    paires: dict[tuple[str, str], set[str]] = defaultdict(set)
    ignores = 0
    for (critere, _valeur), ids in groupes.items():
        ids = sorted(set(ids))
        if len(ids) < 2:
            continue
        if len(ids) > TAILLE_MAX_GROUPE:
            ignores += 1
            continue
        for a, b in combinations(ids, 2):
            paires[(a, b)].add(critere)
    existantes = {(p.id_a, p.id_b): p for p in db.query(PaireDoublon).all()}
    nouvelles = 0
    for (a, b), crit in paires.items():
        p = existantes.get((a, b))
        if p is None:
            db.add(PaireDoublon(id_a=a, id_b=b, criteres=sorted(crit), niveau=_niveau(crit)))
            nouvelles += 1
        elif p.decision is None:
            union = crit | set(p.criteres or [])
            if set(p.criteres or []) != union or p.niveau != _niveau(union):
                p.criteres = sorted(union)
                p.niveau = _niveau(union)
    db.flush()
    return {"paires_detectees": len(paires), "nouvelles_paires": nouvelles, "groupes_ignores": ignores}


def fusionner(db: Session, principal_id: str, secondaire_id: str, motif: str, origine: str = "doublon") -> dict:
    principal = db.get(Entreprise, principal_id)
    secondaire = db.get(Entreprise, secondaire_id)
    if principal is None or secondaire is None:
        raise DecisionInvalide("Entreprise introuvable")
    if principal.statut != STATUT_ACTIVE:
        raise DecisionInvalide(f"{principal_id} n'est pas active")
    deplaces = {"interactions": 0, "opportunites": 0, "qualification": 0}
    for i in db.query(Interaction).filter(Interaction.entreprise_id == secondaire_id):
        i.entreprise_id = principal_id
        deplaces["interactions"] += 1
    for o in db.query(Opportunite).filter(Opportunite.entreprise_id == secondaire_id):
        o.entreprise_id = principal_id
        deplaces["opportunites"] += 1
    q_sec = db.get(Qualification, secondaire_id)
    if q_sec is not None and db.get(Qualification, principal_id) is None:
        # La clé primaire est l'ID entreprise : on recrée la qualification sous l'ID principal.
        data = {c.key: getattr(q_sec, c.key) for c in Qualification.__table__.columns if c.key != "entreprise_id"}
        db.delete(q_sec)
        db.flush()
        db.add(Qualification(entreprise_id=principal_id, **data))
        deplaces["qualification"] = 1
    if principal.commercial_id is None and secondaire.commercial_id is not None:
        principal.commercial_id = secondaire.commercial_id
        principal.date_attribution = secondaire.date_attribution
    principal.est_cliente = principal.est_cliente or secondaire.est_cliente
    secondaire.statut = STATUT_FUSIONNEE
    secondaire.fusionnee_vers = principal_id
    alias = db.get(EntiteAlias, secondaire_id)
    if alias is None:
        db.add(EntiteAlias(ancien_id=secondaire_id, nouvel_id=principal_id, origine=origine, motif=motif))
    else:
        alias.nouvel_id = principal_id
    # Les alias qui pointaient vers l'ID secondaire pointent désormais vers le principal.
    for a in db.query(EntiteAlias).filter(EntiteAlias.nouvel_id == secondaire_id):
        a.nouvel_id = principal_id
    db.flush()
    return deplaces


def decider(db: Session, paire: PaireDoublon, decision: str, auteur: str, id_principal: str | None = None,
            justification: str | None = None) -> PaireDoublon:
    if paire.decision is not None:
        raise DecisionInvalide(f"Décision déjà prise : {paire.decision}")
    if decision not in (DECISION_DOUBLON, DECISION_DISTINCTES):
        raise DecisionInvalide("Décision attendue : « Doublon confirmé » ou « Entreprises distinctes »")
    justification = (justification or "").strip() or None
    if decision == DECISION_DOUBLON:
        criteres = set(paire.criteres or [])
        if not (criteres - {CRITERE_NOM}) and len(justification or "") < JUSTIFICATION_MIN:
            raise DecisionInvalide(
                "Fusion refusée : le rapprochement repose sur le seul nom. "
                f"Vérifiez un identifiant (NINEA, RCCM, téléphone) et saisissez une justification ({JUSTIFICATION_MIN} caractères minimum)."
            )
        id_principal = id_principal or paire.id_a
        if id_principal not in (paire.id_a, paire.id_b):
            raise DecisionInvalide("L'ID principal doit être l'une des deux entreprises de la paire")
        secondaire = paire.id_b if id_principal == paire.id_a else paire.id_a
        for eid in (paire.id_a, paire.id_b):
            e = db.get(Entreprise, eid)
            if e is None or e.statut != STATUT_ACTIVE:
                raise DecisionInvalide(f"{eid} n'est plus active")
        fusionner(db, id_principal, secondaire, justification or ", ".join(paire.criteres or []))
        paire.id_principal = id_principal
    paire.decision = decision
    paire.justification = justification
    paire.decide_par = auteur
    paire.decide_le = datetime.now().replace(microsecond=0)
    db.flush()
    return paire
