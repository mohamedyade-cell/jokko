"""KPI exacts sur un jeu de test construit à la main (valeurs attendues calculées manuellement)."""
from __future__ import annotations

from datetime import date

import pytest

from app import kpi
from app import parametres as P
from app.models import Entreprise, Interaction, Opportunite, Qualification, Segment
from app.services import recalculer

AUJ = date(2026, 10, 26)  # lundi


@pytest.fixture
def jeu(db, users):
    P.definir(db, "vagues_lancees", [1])
    P.definir(db, "date_lancement", "2026-07-26")
    db.add(Segment(nom="S", vague_defaut=1))
    fx1, fx2 = users["fx1"].id, users["fx2"].id
    for k in range(1, 11):
        db.add(Entreprise(id=f"ENT-{k:05d}", raison_sociale=f"[FICTIF] E{k}", segment="S", fictif=True, champs_verrouilles=[],
                          vague_manuelle=1 if k <= 6 else 2,
                          statut_validation="Validée" if k <= 8 else "À vérifier",
                          commercial_id=fx1 if k <= 4 else (fx2 if k <= 6 else None)))
    db.flush()
    I = lambda e, d, c, **kw: db.add(Interaction(entreprise_id=f"ENT-{e:05d}", date=d, commercial_id=c, type=kw.pop("type", "Appel"), **kw))
    I(1, date(2026, 10, 20), fx1, joint=True, decideur_joint=True, rdv_obtenu=True, date_rdv=date(2026, 10, 30))
    I(2, date(2026, 10, 21), fx1, joint=False)
    I(2, date(2026, 10, 22), fx1, joint=True)
    I(3, date(2026, 9, 1), fx1, joint=False)
    I(5, date(2026, 10, 26), fx2, joint=True, type="Visite")
    I(9, date(2026, 10, 1), None, joint=True)
    db.add(Qualification(entreprise_id="ENT-00001", qualifiee=True))
    db.add(Qualification(entreprise_id="ENT-00002", qualifiee=False))
    db.add(Opportunite(entreprise_id="ENT-00001", etape="12. Gagnée", montant=1_000_000, devise="EUR", marge_pb=30, probabilite=100))
    db.add(Opportunite(entreprise_id="ENT-00005", etape="10. Proposition / cotation", montant=100_000_000, devise="XOF",
                       marge_pb=25, probabilite=60, date_ouverture=date(2026, 10, 26)))
    db.flush()
    recalculer(db)
    db.commit()


def test_entonnoir(db, jeu):
    d = kpi.calculer(db, today=AUJ)
    assert {e["etape"]: e["valeur"] for e in d["entonnoir"]} == {
        "ciblees": 6, "attribuees": 6, "contactees": 5, "jointes": 4, "decideur": 1, "qualifiees": 1, "rdv": 2,
        "opportunite": 2, "cliente": 1}
    assert d["volumes"] == {"fiches": 0, "entreprises_uniques": 10, "base_validee": 8, "interactions": 6}


def test_taux_et_couverture(db, jeu):
    d = kpi.calculer(db, today=AUJ)
    assert d["taux"] == {"joignabilite": 80.0, "rdv": 50.0, "conversion": 50.0}
    c = d["couverture"]
    assert c["base_validee"] == 8 and c["contactees_base_validee"] == 4 and c["reelle_pct"] == 50.0
    assert c["objectif_pct"] == 50 and c["objectif_entreprises"] == 4
    assert c["attendu_a_date_pct"] == 25.2  # 92 jours / 6 mois × 50 %


def test_series_hebdo_mensuelles(db, jeu):
    d = kpi.calculer(db, today=AUJ)
    h = d["hebdomadaire"]
    assert len(h) == 12 and h[-1]["debut"] == "2026-10-26"
    assert (h[-1]["interactions"], h[-1]["contactees"], h[-1]["rdv"], h[-1]["opportunites"]) == (1, 1, 1, 1)
    assert (h[-2]["interactions"], h[-2]["contactees"], h[-2]["jointes"], h[-2]["rdv"]) == (3, 2, 2, 1)
    m = d["mensuel"]
    assert len(m) == 12 and m[-1]["periode"] == "10/2026"
    assert m[-1]["interactions"] == 5 and m[-2]["interactions"] == 1


def test_repartitions(db, jeu):
    d = kpi.calculer(db, today=AUJ)
    vagues = {r["cle"]: (r["total"], r["contactees"]) for r in d["repartition"]["vague"]}
    assert vagues == {1: (6, 4), 2: (4, 1)}
    assert sum(r["total"] for r in d["repartition"]["categorie"]) == 10


def test_pipeline(db, jeu):
    p = kpi.calculer(db, today=AUJ)["pipeline"]
    assert p == {"opportunites_ouvertes": 1, "montant_ouvert_fcfa": 100_000_000, "montant_pondere_fcfa": 60_000_000,
                 "pnb_estime_fcfa": 250_000, "gagnees": 1, "montant_gagne_fcfa": 655_957_000}


def test_performance_par_commercial(db, jeu, users):
    perf = {p["commercial"]: p for p in kpi.calculer(db, today=AUJ)["performance"]}
    f1 = perf["Commercial Fictif 1"]
    assert (f1["portefeuille"], f1["contactees"], f1["jointes"], f1["rdv"], f1["opportunites"], f1["clientes"], f1["interactions"]) == (4, 3, 2, 1, 1, 1, 4)
    assert f1["taux_couverture"] == 75.0
    f2 = perf["Commercial Fictif 2"]
    assert (f2["portefeuille"], f2["contactees"], f2["rdv"], f2["montant_pipeline_fcfa"]) == (2, 1, 1, 100_000_000)
    assert perf["Commercial Fictif 3"]["portefeuille"] == 0


def test_perimetre_commercial(db, jeu, users):
    d = kpi.calculer(db, commercial_id=users["fx1"].id, today=AUJ)
    assert d["volumes"]["entreprises_uniques"] == 4
    assert {e["etape"]: e["valeur"] for e in d["entonnoir"]}["contactees"] == 3
