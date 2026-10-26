"""Score sur 100, catégories A/B/C/D, priorité des valeurs confirmées et règles de vague."""
from __future__ import annotations

import pytest

from app import parametres as P
from app.models import Entreprise, Segment, Taille
from app.scoring import EntreeScore, calculer_score, calculer_vague, categorie
from app.services import recalculer

PARAMS = P.DEFAUTS
SEG = {"import_pts": 20, "export_pts": 0, "intensite_pts": 12, "frequence_pts": 12, "couverture_pts": 8, "potentiel_pts": 8}
TAILLE = {"intensite_pts": 15, "frequence_pts": 15, "potentiel_pts": 10}


def test_score_hypotheses_segment_taille():
    r = calculer_score(EntreeScore(segment="Négoce import", taille="Grande", telephone="338000000", email="a@b.sn",
                                   contact_nom="X", segment_pts=SEG, taille_pts=TAILLE), PARAMS)
    c = r["criteres"]
    assert c["import"]["points"] == 20 and c["import"]["origine"] == "segment"
    assert c["export"]["points"] == 0
    assert c["intensite"]["points"] == 15 and c["intensite"]["origine"] == "taille"
    assert c["frequence"]["points"] == 15  # max(segment 12, taille 15)
    assert c["couverture"]["points"] == 8
    assert c["accessibilite"]["points"] == 10
    assert c["potentiel"]["points"] == 8
    assert r["score"] == 76 and r["categorie"] == "A"


def test_frequence_max_segment_taille():
    r = calculer_score(EntreeScore(segment="S", taille="PME", segment_pts={**SEG, "frequence_pts": 12},
                                   taille_pts={**TAILLE, "frequence_pts": 9}), PARAMS)
    assert r["criteres"]["frequence"]["points"] == 12 and r["criteres"]["frequence"]["origine"] == "segment"


def test_plafonds_respectes():
    r = calculer_score(EntreeScore(segment="S", segment_pts={k: 99 for k in SEG}, taille_pts={}), PARAMS)
    for k, v in r["criteres"].items():
        assert v["points"] <= v["max"]
    assert r["score"] <= 100


def test_valeur_confirmee_remplace_hypothese():
    base = EntreeScore(segment="S", taille="Grande", import_hyp=True, export_hyp=False, segment_pts=SEG, taille_pts=TAILLE)
    q = {"import_confirme": False, "export_confirme": True, "volume_annuel_fcfa": 200_000_000, "frequence": "Trimestrielle",
         "besoin_confirme": False, "potentiel": "Faible", "produits": []}
    r = calculer_score(EntreeScore(**{**base.__dict__, "qualification": q}), PARAMS)
    c = r["criteres"]
    assert c["import"]["points"] == 0 and c["import"]["origine"] == "confirmé"
    assert c["export"]["points"] == 20 and c["export"]["origine"] == "confirmé"
    assert c["intensite"]["points"] == 6 and c["intensite"]["origine"] == "confirmé"
    assert c["frequence"]["points"] == 5
    assert c["couverture"]["points"] == 0
    assert c["potentiel"]["points"] == 2


def test_hypothese_base_prioritaire_sur_segment():
    r = calculer_score(EntreeScore(segment="S", import_hyp=False, segment_pts=SEG), PARAMS)
    assert r["criteres"]["import"]["points"] == 0 and r["criteres"]["import"]["origine"] == "base"


def test_decideur_joint_accessibilite_max():
    r = calculer_score(EntreeScore(segment="S", decideur_joint=True, segment_pts=SEG), PARAMS)
    assert r["criteres"]["accessibilite"]["points"] == 10


@pytest.mark.parametrize("score,cat", [(100, "A"), (75, "A"), (74, "B"), (55, "B"), (54, "C"), (35, "C"), (34, "D"), (0, "D")])
def test_seuils_categories(score, cat):
    assert categorie(score, PARAMS) == cat


def test_seuils_parametrables():
    p = {**PARAMS, "seuil_A": 80, "seuil_B": 60, "seuil_C": 40}
    assert categorie(78, p) == "B" and categorie(39, p) == "D"


def test_arrondi_commercial():
    # 0,5 arrondi au supérieur (comme ARRONDI d'Excel), pas l'arrondi bancaire
    r = calculer_score(EntreeScore(segment="S", segment_pts={"import_pts": 20, "export_pts": 0.5}, taille_pts={}), PARAMS)
    assert r["score"] == 21


# --- Vagues ---------------------------------------------------------------------------------------

def V(**kw):
    defaults = dict(segment="Négoce import", categorie_="B", taille="PME", vague_manuelle=None, vague_segment=2, params=PARAMS)
    return calculer_vague(**{**defaults, **kw})


def test_vague_banques_4_meme_categorie_A():
    assert V(segment="Banques et établissements financiers", categorie_="A", taille="Grande")[0] == 4


def test_vague_categorie_A_1():
    assert V(categorie_="A", vague_segment=3)[0] == 1


def test_vague_grande_taille_1():
    assert V(taille="Grande", categorie_="C", vague_segment=3) == (1, "Taille Grande → 1")


def test_vague_grande_taille_hors_autres_secteurs():
    assert V(segment="Autres secteurs", taille="Grande", categorie_="C", vague_segment=3)[0] == 3


def test_vague_grande_taille_option_desactivee():
    assert V(taille="Grande", categorie_="C", vague_segment=3, params={**PARAMS, "vague_grande_taille_active": False})[0] == 3


def test_vague_grande_taille_prioritaire_sur_D():
    assert V(taille="Grande", categorie_="D", vague_segment=3)[0] == 1


def test_vague_categorie_D_4():
    assert V(categorie_="D", vague_segment=1)[0] == 4


def test_vague_defaut_segment():
    assert V(categorie_="B", vague_segment=2) == (2, "Vague par défaut du segment")


def test_vague_defaut_parametre_si_segment_sans_vague():
    assert V(categorie_="C", vague_segment=None)[0] == PARAMS["vague_defaut"]


def test_vague_manuelle_prioritaire_sur_tout():
    assert V(segment="Banques et établissements financiers", categorie_="A", vague_manuelle=2)[0] == 2


# --- Recalcul instantané en base -------------------------------------------------------------------

def test_recalcul_instantane_api(clients, db):
    c = clients["resp"]
    e = c.get("/api/entreprises/ENT-00003").json()
    assert e["score"] == int(sum(x["points"] for x in e["score_detail"]) + 0.5)
    r = c.put("/api/entreprises/ENT-00003/qualification", json={
        "import_confirme": True, "export_confirme": True, "volume_annuel_fcfa": 6e9, "frequence": "Quotidienne",
        "besoin_confirme": True, "potentiel": "Élevé", "qualifiee": True, "produits": ["Forward"], "devises": ["eur"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["categorie"] == "A" and body["score"] >= 90
    assert body["vague"] == 1
    # Modification d'un seuil : recalcul de toute la base
    r = c.put("/api/parametres/seuil_A", json={"valeur": 99})
    assert r.status_code == 200 and r.json()["recalculees"] == 200
    assert c.get("/api/entreprises/ENT-00003").json()["categorie"] == "B"
    assert c.put("/api/parametres/seuil_B", json={"valeur": 99.5}).status_code == 422  # A > B > C


def test_recalcul_service(db):
    db.add(Segment(nom="S", import_pts=20, export_pts=20, intensite_pts=15, frequence_pts=15, couverture_pts=10, potentiel_pts=10, vague_defaut=2))
    db.add(Taille(nom="PME", intensite_pts=5, frequence_pts=5, potentiel_pts=5))
    db.add(Entreprise(id="ENT-90001", raison_sociale="[FICTIF] Test", segment="S", taille="PME", telephone="338000000",
                      email="a@fictif.example", contact_nom="X", fictif=True, champs_verrouilles=[]))
    db.flush()
    recalculer(db)
    e = db.get(Entreprise, "ENT-90001")
    assert e.score == 90 and e.categorie == "A" and e.vague == 1
