"""Calcul des indicateurs du tableau de bord.

Définitions (affichées dans l'interface et dans docs/GUIDE_UTILISATEUR.md) :
- Ciblées : entreprises validées dont la vague est lancée.
- Attribuées : entreprises ayant un commercial.
- Contactées : au moins une interaction ; Jointes : au moins une interaction « joint ».
- Décideur joint : au moins une interaction « décideur joint ».
- Qualifiées : qualification FX marquée « qualifiée ».
- RDV : RDV obtenu ou interaction de type RDV / Visite.
- Opportunité : au moins une opportunité au pipeline.
- Cliente : statut client ou opportunité à l'étape gagnée.
Chaque étape est comptée sur les entreprises actives (non fusionnées) du périmètre.

Taux : joignabilité = jointes / contactées ; RDV = RDV / jointes ;
conversion = clientes / entreprises avec opportunité.
Couverture = contactées parmi la base validée / base validée.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import parametres as P
from .models import (
    ROLE_FX_SALES,
    STATUT_ACTIVE,
    VALIDATION_VALIDEE,
    Entreprise,
    ExecutionImport,
    Fiche,
    Interaction,
    Objectif,
    Opportunite,
    Qualification,
    Utilisateur,
)
from .utils import vers_date

ETAPES_ENTONNOIR = [
    ("ciblees", "Ciblées"), ("attribuees", "Attribuées"), ("contactees", "Contactées"), ("jointes", "Jointes"),
    ("decideur", "Décideur joint"), ("qualifiees", "Qualifiées"), ("rdv", "RDV"), ("opportunite", "Opportunité"),
    ("cliente", "Cliente"),
]


def _taux(num: int, den: int) -> float | None:
    return round(100 * num / den, 1) if den else None


def _lundi(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _mois_avant(d: date, n: int) -> date:
    y, m = d.year, d.month - n
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def date_lancement(db: Session, params: dict) -> date | None:
    d = vers_date(params.get("date_lancement"))
    if d:
        return d
    premier = db.query(func.min(ExecutionImport.debut)).scalar()
    return premier.date() if premier else None


def calculer(db: Session, params: dict | None = None, commercial_id: int | None = None, today: date | None = None) -> dict:
    params = params or P.charger(db)
    today = today or date.today()
    lancees = set(params.get("vagues_lancees") or [])
    gagnee, perdue = P.etape_gagnee(params), P.etape_perdue(params)

    q = db.query(Entreprise.id, Entreprise.commercial_id, Entreprise.categorie, Entreprise.segment, Entreprise.vague,
                 Entreprise.statut_validation, Entreprise.est_cliente).filter(Entreprise.statut == STATUT_ACTIVE)
    if commercial_id is not None:
        q = q.filter(Entreprise.commercial_id == commercial_id)
    ents = q.all()
    ids = {e.id for e in ents}

    inter = [i for i in db.query(Interaction.entreprise_id, Interaction.commercial_id, Interaction.date, Interaction.joint,
                                 Interaction.decideur_joint, Interaction.rdv_obtenu, Interaction.type).all()
             if i.entreprise_id in ids]
    opps = [o for o in db.query(Opportunite.entreprise_id, Opportunite.commercial_id, Opportunite.etape, Opportunite.montant,
                                Opportunite.devise, Opportunite.marge_pb, Opportunite.probabilite,
                                Opportunite.date_ouverture).all() if o.entreprise_id in ids]
    qualifiees = {eid for (eid,) in db.query(Qualification.entreprise_id).filter(Qualification.qualifiee.is_(True))} & ids

    contactees, jointes, decideur, rdv = set(), set(), set(), set()
    for i in inter:
        contactees.add(i.entreprise_id)
        if i.joint:
            jointes.add(i.entreprise_id)
        if i.decideur_joint:
            decideur.add(i.entreprise_id)
        if i.rdv_obtenu or i.type in ("RDV", "Visite"):
            rdv.add(i.entreprise_id)
    avec_opp = {o.entreprise_id for o in opps}
    clientes = {e.id for e in ents if e.est_cliente} | {o.entreprise_id for o in opps if o.etape == gagnee}
    validees = {e.id for e in ents if e.statut_validation == VALIDATION_VALIDEE}
    ciblees = {e.id for e in ents if e.id in validees and e.vague in lancees}
    attribuees = {e.id for e in ents if e.commercial_id is not None}
    ensembles = {"ciblees": ciblees, "attribuees": attribuees, "contactees": contactees, "jointes": jointes,
                 "decideur": decideur, "qualifiees": qualifiees, "rdv": rdv, "opportunite": avec_opp, "cliente": clientes}
    entonnoir = [{"etape": k, "libelle": lib, "valeur": len(ensembles[k])} for k, lib in ETAPES_ENTONNOIR]

    # Couverture vs objectif
    lancement = date_lancement(db, params)
    duree = float(params.get("objectif_duree_mois") or 6)
    obj_pct = float(params.get("objectif_couverture_pct") or 50)
    couv_reelle = _taux(len(contactees & validees), len(validees))
    if lancement:
        mois = max(0.0, (today - lancement).days / 30.4375)
        attendu = round(obj_pct * min(1.0, mois / duree), 1) if duree else obj_pct
    else:
        mois, attendu = None, None
    couverture = {
        "base_validee": len(validees), "contactees_base_validee": len(contactees & validees),
        "reelle_pct": couv_reelle, "objectif_pct": obj_pct, "objectif_entreprises": round(len(validees) * obj_pct / 100),
        "duree_mois": duree, "date_lancement": lancement.isoformat() if lancement else None,
        "mois_ecoules": round(mois, 1) if mois is not None else None, "attendu_a_date_pct": attendu,
    }

    def repartition(attr: str, ordre: list | None = None) -> list[dict]:
        tot, cont = defaultdict(int), defaultdict(int)
        for e in ents:
            k = getattr(e, attr)
            k = k if k is not None else "Non renseigné"
            tot[k] += 1
            cont[k] += e.id in contactees
        keys = ordre if ordre else sorted(tot, key=lambda x: (-tot[x], str(x)))
        return [{"cle": k, "total": tot.get(k, 0), "contactees": cont.get(k, 0)} for k in keys]

    # Séries hebdomadaires (12 semaines) et mensuelles (12 mois)
    debut_sem = _lundi(today) - timedelta(weeks=11)
    hebdo = {debut_sem + timedelta(weeks=k): {"interactions": 0, "contactees": set(), "jointes": set(), "rdv": set(), "opportunites": 0}
             for k in range(12)}
    debut_mois = _mois_avant(today, 11)
    mensuel = {}
    for k in range(12):
        m = _mois_avant(today, 11 - k)
        mensuel[m] = {"interactions": 0, "contactees": set(), "jointes": set(), "rdv": set(), "opportunites": 0}
    for i in inter:
        for serie, cle in ((hebdo, _lundi(i.date)), (mensuel, date(i.date.year, i.date.month, 1))):
            b = serie.get(cle)
            if b is None:
                continue
            b["interactions"] += 1
            b["contactees"].add(i.entreprise_id)
            if i.joint:
                b["jointes"].add(i.entreprise_id)
            if i.rdv_obtenu or i.type in ("RDV", "Visite"):
                b["rdv"].add(i.entreprise_id)
    for o in opps:
        if o.date_ouverture:
            for serie, cle in ((hebdo, _lundi(o.date_ouverture)), (mensuel, date(o.date_ouverture.year, o.date_ouverture.month, 1))):
                if cle in serie:
                    serie[cle]["opportunites"] += 1

    def aplatir(serie: dict, fmt) -> list[dict]:
        return [{"periode": fmt(k), "debut": k.isoformat(), "interactions": v["interactions"], "contactees": len(v["contactees"]),
                 "jointes": len(v["jointes"]), "rdv": len(v["rdv"]), "opportunites": v["opportunites"]} for k, v in sorted(serie.items())]

    # Pipeline
    def fcfa(o) -> float:
        return (o.montant or 0) * P.taux_fcfa(params, o.devise)

    ouvertes = [o for o in opps if o.etape not in (gagnee, perdue)]
    pipeline = {
        "opportunites_ouvertes": len(ouvertes),
        "montant_ouvert_fcfa": round(sum(fcfa(o) for o in ouvertes)),
        "montant_pondere_fcfa": round(sum(fcfa(o) * (o.probabilite or 0) / 100 for o in ouvertes)),
        "pnb_estime_fcfa": round(sum(fcfa(o) * (o.marge_pb if o.marge_pb is not None else params["marge_pb_defaut"]) / 10000 for o in ouvertes)),
        "gagnees": sum(1 for o in opps if o.etape == gagnee),
        "montant_gagne_fcfa": round(sum(fcfa(o) for o in opps if o.etape == gagnee)),
    }

    # Performance par commercial
    users = db.query(Utilisateur).filter(Utilisateur.actif.is_(True)).all()
    objectifs = {o.utilisateur_id: o for o in db.query(Objectif)}
    portefeuille = defaultdict(set)
    for e in ents:
        if e.commercial_id:
            portefeuille[e.commercial_id].add(e.id)
    il_y_a_7j = today - timedelta(days=7)
    perf = []
    for u in users:
        if u.role != ROLE_FX_SALES and u.id not in portefeuille:
            continue
        if commercial_id is not None and u.id != commercial_id:
            continue
        pf = portefeuille.get(u.id, set())
        mes_inter = [i for i in inter if i.commercial_id == u.id]
        mes_opps = [o for o in opps if o.entreprise_id in pf]
        mes_ouvertes = [o for o in mes_opps if o.etape not in (gagnee, perdue)]
        obj = objectifs.get(u.id)
        ligne = {
            "commercial_id": u.id, "commercial": u.nom, "portefeuille": len(pf),
            "contactees": len(pf & contactees), "jointes": len(pf & jointes), "decideur": len(pf & decideur),
            "qualifiees": len(pf & qualifiees), "rdv": len(pf & rdv), "opportunites": len(pf & avec_opp),
            "clientes": len(pf & clientes), "interactions": len(mes_inter),
            "interactions_7j": sum(1 for i in mes_inter if i.date >= il_y_a_7j),
            "montant_pipeline_fcfa": round(sum(fcfa(o) for o in mes_ouvertes)),
            "taux_couverture": _taux(len(pf & contactees), len(pf)),
            "taux_joignabilite": _taux(len(pf & jointes), len(pf & contactees)),
            "objectifs": None,
        }
        if obj:
            ligne["objectifs"] = {k: getattr(obj, k) for k in ("portefeuille", "contacts", "rdv", "opportunites", "clients", "volume_fcfa")}
        perf.append(ligne)

    nb_fiches = db.query(func.count(Fiche.id)).scalar() or 0
    if commercial_id is not None:
        nb_fiches = db.query(func.count(Fiche.id)).filter(Fiche.entreprise_id.in_(ids)).scalar() if ids else 0

    return {
        "date": today.isoformat(),
        "perimetre": "commercial" if commercial_id is not None else "equipe",
        "volumes": {"fiches": nb_fiches, "entreprises_uniques": len(ents), "base_validee": len(validees),
                    "interactions": len(inter)},
        "entonnoir": entonnoir,
        "couverture": couverture,
        "taux": {"joignabilite": _taux(len(jointes), len(contactees)), "rdv": _taux(len(rdv), len(jointes)),
                 "conversion": _taux(len(clientes & avec_opp), len(avec_opp))},
        "repartition": {"categorie": repartition("categorie", ["A", "B", "C", "D"]),
                        "segment": repartition("segment"),
                        "vague": repartition("vague", sorted({e.vague for e in ents if e.vague is not None}))},
        "hebdomadaire": aplatir(hebdo, lambda d: f"S{d.isocalendar()[1]:02d} ({d.strftime('%d/%m')})"),
        "mensuel": aplatir(mensuel, lambda d: d.strftime("%m/%Y")),
        "pipeline": pipeline,
        "performance": perf,
    }
