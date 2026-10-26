"""Décisions de doublons : jamais de fusion sur le seul nom, traçabilité, alias."""
from __future__ import annotations

import pytest

from app import doublons as D
from app.models import DECISION_DISTINCTES, DECISION_DOUBLON, Entreprise, EntiteAlias, Interaction, PaireDoublon


def _paire(db, a, b):
    return db.query(PaireDoublon).filter_by(id_a=a, id_b=b).one()


def test_detection_niveaux(db, imported):
    fort = _paire(db, "ENT-00006", "ENT-00007")
    assert "NINEA identique" in fort.criteres and fort.niveau == "fort"
    nom = _paire(db, "ENT-00008", "ENT-00009")
    assert nom.criteres == [D.CRITERE_NOM] and nom.niveau == "faible"


def test_detection_idempotente(db, imported):
    n = db.query(PaireDoublon).count()
    assert D.detecter(db)["nouvelles_paires"] == 0
    assert db.query(PaireDoublon).count() == n


def test_refus_fusion_sur_le_seul_nom(db, imported):
    p = _paire(db, "ENT-00008", "ENT-00009")
    with pytest.raises(D.DecisionInvalide, match="seul nom"):
        D.decider(db, p, DECISION_DOUBLON, "resp")
    with pytest.raises(D.DecisionInvalide):
        D.decider(db, p, DECISION_DOUBLON, "resp", justification="même nom")  # trop court
    assert p.decision is None
    assert db.get(Entreprise, "ENT-00009").statut == "Active"


def test_fusion_nom_seul_avec_justification(db, imported):
    p = _paire(db, "ENT-00008", "ENT-00009")
    D.decider(db, p, DECISION_DOUBLON, "resp", "ENT-00008", "NINEA vérifié au téléphone avec le DAF : même entité")
    assert db.get(Entreprise, "ENT-00009").statut == "Fusionnée"


def test_doublon_confirme_fusion_tracee(db, imported):
    p = _paire(db, "ENT-00006", "ENT-00007")
    db.add(Interaction(entreprise_id="ENT-00007", date=__import__("datetime").date(2026, 10, 1), type="Appel"))
    db.flush()
    D.decider(db, p, DECISION_DOUBLON, "resp", id_principal="ENT-00006")
    db.commit()
    e7 = db.get(Entreprise, "ENT-00007")
    assert e7 is not None, "jamais de suppression"
    assert e7.statut == "Fusionnée" and e7.fusionnee_vers == "ENT-00006"
    assert db.get(EntiteAlias, "ENT-00007").nouvel_id == "ENT-00006"
    assert db.query(Interaction).filter_by(entreprise_id="ENT-00007").count() == 0
    assert p.decide_par == "resp" and p.decide_le is not None
    with pytest.raises(D.DecisionInvalide, match="déjà"):
        D.decider(db, p, DECISION_DISTINCTES, "resp")


def test_entreprises_distinctes(db, imported):
    p = _paire(db, "ENT-00008", "ENT-00009")
    D.decider(db, p, DECISION_DISTINCTES, "resp", justification="Deux sociétés différentes")
    db.commit()
    assert db.get(Entreprise, "ENT-00009").statut == "Active"
    # La paire décidée n'est plus proposée, même après une nouvelle détection
    D.detecter(db)
    assert _paire(db, "ENT-00008", "ENT-00009").decision == DECISION_DISTINCTES


def test_decision_invalide(db, imported):
    p = _paire(db, "ENT-00006", "ENT-00007")
    with pytest.raises(D.DecisionInvalide):
        D.decider(db, p, "Fusionner", "resp")
    with pytest.raises(D.DecisionInvalide):
        D.decider(db, p, DECISION_DOUBLON, "resp", id_principal="ENT-00001")


def test_api_doublons(clients, db):
    r = clients["resp"].get("/api/doublons").json()
    assert r["total"] >= 2
    item = next(i for i in r["items"] if i["a"]["id"] == "ENT-00008")
    assert item["nom_seul"] is True and item["b"]["id"] == "ENT-00009"
    assert clients["fx1"].post(f"/api/doublons/{item['id']}/decision", json={"decision": DECISION_DISTINCTES}).status_code == 403
    r = clients["resp"].post(f"/api/doublons/{item['id']}/decision", json={"decision": DECISION_DOUBLON})
    assert r.status_code == 422 and "seul nom" in r.json()["detail"]
    r = clients["resp"].post(f"/api/doublons/{item['id']}/decision", json={"decision": DECISION_DISTINCTES})
    assert r.status_code == 200
