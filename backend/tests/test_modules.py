"""Parcours fonctionnels : Base, fiche 360°, Call Tracker, Agenda, Pipeline, Wallet, Qualité, Exports, performance."""
from __future__ import annotations

import io
import random
import time
from datetime import date, timedelta

from openpyxl import load_workbook

from app.models import Entreprise, Interaction, Segment, Taille
from app.services import recalculer, texte_recherche
from tests.conftest import connecter


def test_recherche_plein_texte(clients):
    c = clients["resp"]
    assert c.get("/api/entreprises", params={"q": "000000012"}).json()["items"][0]["id"] == "ENT-00012"  # NINEA
    assert c.get("/api/entreprises", params={"q": "FIC12"}).json()["total"] >= 1  # sigle
    assert c.get("/api/entreprises", params={"q": "SN-FIC-2019-B-1012"}).json()["items"][0]["id"] == "ENT-00012"  # RCCM
    tel = c.get("/api/entreprises/ENT-00001").json()["telephone"]
    assert c.get("/api/entreprises", params={"q": tel.replace(" ", "")[-7:]}).json()["total"] >= 1  # téléphone


def test_filtres(clients):
    c = clients["resp"]
    tot = c.get("/api/entreprises").json()["total"]
    a = c.get("/api/entreprises", params={"categorie": "A"}).json()
    assert all(i["categorie"] == "A" for i in a["items"]) and a["total"] < tot
    s = c.get("/api/entreprises", params={"segment": "Services", "statut": "non_contactee"}).json()
    assert all(i["segment"] == "Services" for i in s["items"])
    assert c.get("/api/entreprises", params={"statut": "cliente"}).json()["total"] >= 1


def test_fiche_360_sources(clients):
    f = clients["resp"].get("/api/entreprises/ENT-00004").json()
    ninea = next(x for x in f["identite"] if x["champ"] == "ninea")
    assert ninea["source"]["fichier"].startswith("CCI_FICTIF_") and ninea["source"]["page"] >= 1
    assert ninea["source"]["url_pdf"].startswith("/api/sources/fichiers/")
    naema = next(x for x in f["identite"] if x["champ"] == "naema_code")
    rccm = next(x for x in f["identite"] if x["champ"] == "rccm")
    assert naema["libelle"] != rccm["libelle"] and naema["valeur"] != rccm["valeur"]
    assert len(f["score_detail"]) == 7 and f["accroche"]
    assert f["qualification"] and f["opportunites"] and f["interactions"]
    # ancien ID → redirection après fusion
    assert clients["resp"].get("/api/entreprises/ENT-99999").status_code == 404


def test_call_tracker_et_agenda(clients, db, users):
    c = clients["fx1"]
    eid = sorted(e.id for e in db.query(Entreprise).filter_by(commercial_id=users["fx1"].id))[0]
    today = date.today()
    r = c.post("/api/interactions", json={"entreprise_id": eid, "date": today.isoformat(), "type": "Appel", "tentative": 2,
                                          "joint": True, "decideur_joint": True, "resultat": "Intéressé",
                                          "prochaine_action": "Envoyer offre", "date_prochaine_action": (today - timedelta(days=1)).isoformat()})
    assert r.status_code == 201, r.text
    # validations
    assert c.post("/api/interactions", json={"entreprise_id": eid, "date": today.isoformat(), "type": "Fax"}).status_code == 422
    assert c.post("/api/interactions", json={"entreprise_id": eid, "date": today.isoformat(), "decideur_joint": True}).status_code == 422
    ag = c.get("/api/agenda").json()
    assert any(x["entreprise_id"] == eid for x in ag["en_retard"])
    # une nouvelle interaction solde la relance précédente
    c.post("/api/interactions", json={"entreprise_id": eid, "date": today.isoformat(), "type": "E-mail", "rdv_obtenu": True,
                                      "date_rdv": (today + timedelta(days=3)).isoformat()})
    ag = c.get("/api/agenda").json()
    assert not any(x["entreprise_id"] == eid for x in ag["en_retard"])
    assert any(x["entreprise_id"] == eid for x in ag["rdv"])


def test_pipeline_kanban(clients, db):
    c = clients["resp"]
    k = c.get("/api/pipeline/kanban").json()
    assert len(k["etapes"]) == 13
    r = c.post("/api/opportunites", json={"entreprise_id": "ENT-00016", "etape": "1. Identifiée", "montant": 1000, "devise": "USD"})
    assert r.status_code == 201
    o = r.json()
    assert o["montant_fcfa"] == 600_000 and o["marge_pb"] == 25 and o["pnb_estime_fcfa"] == 1500
    r = c.post(f"/api/opportunites/{o['id']}/etape", json={"etape": "12. Gagnée"})
    assert r.json()["probabilite"] == 100
    assert db.get(Entreprise, "ENT-00016").est_cliente


def test_wallet_attribution_masse(clients, users):
    c = clients["resp"]
    cibles = c.get("/api/wallet/cibles", params={"categorie": "A,B,C,D"}).json()
    assert cibles["total"] > 0
    ids = [i["id"] for i in cibles["items"][:5]]
    assert c.post("/api/wallet/attribuer", json={"ids": ids, "commercial_id": users["fx3"].id}).json()["attribuees"] == 5
    w = c.get("/api/wallet").json()
    assert next(x for x in w["commerciaux"] if x["commercial_id"] == users["fx3"].id)["portefeuille"] >= 5
    assert c.put(f"/api/wallet/objectifs/{users['fx3'].id}", json={"contacts": 100, "rdv": 20}).status_code == 200


def test_qualite(clients):
    c = clients["resp"]
    a = c.get("/api/qualite/anomalies").json()
    assert a["par_type"].get("Aucun moyen de contact", 0) >= 0
    e1 = c.get("/api/qualite/echantillon", params={"graine": "S1"}).json()
    e2 = c.get("/api/qualite/echantillon", params={"graine": "S1"}).json()
    assert e1["taille"] == 30 and [i["id"] for i in e1["items"]] == [i["id"] for i in e2["items"]]
    av = c.get("/api/qualite/a-verifier").json()
    eid = av["items"][0]["id"]
    assert c.post(f"/api/qualite/{eid}/valider", json={}).status_code == 200
    assert c.get("/api/qualite/a-verifier").json()["total"] == av["total"] - 1


def test_exports(clients):
    c = clients["resp"]
    r = c.get("/api/exports/entreprises", params={"format": "xlsx", "categorie": "A"})
    assert r.status_code == 200
    ws = load_workbook(io.BytesIO(r.content)).active
    assert "FICTIVES" in ws["A1"].value and ws["A2"].value == "ID"
    nb_a = c.get("/api/entreprises", params={"categorie": "A"}).json()["total"]
    assert ws.max_row - 2 == nb_a
    r = c.get("/api/exports/interactions", params={"format": "csv"})
    texte = r.content.decode("utf-8-sig")
    assert "Date;ID;Raison sociale" in texte and "/2026" in texte  # dates jj/mm/aaaa
    r = c.get("/api/exports/rapport/hebdomadaire.pdf")
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    assert clients["fx1"].get("/api/exports/audit").status_code == 403


def test_performance_6000_entreprises(app, db, users):
    rng = random.Random(1)
    db.add(Segment(nom="Négoce", import_pts=20, frequence_pts=10, vague_defaut=1))
    db.add(Taille(nom="PME", intensite_pts=8, frequence_pts=9, potentiel_pts=5))
    fx = [users["fx1"].id, users["fx2"].id, users["fx3"].id, None]
    rows = []
    for k in range(1, 6001):
        e = Entreprise(id=f"ENT-{k:05d}", raison_sociale=f"[FICTIF] Perf {k}", ninea=f"000{k:06d}", telephone=f"33 8{k:05d}0",
                       segment="Négoce", taille="PME", region="Dakar", commercial_id=fx[k % 4], statut_validation="Validée",
                       fictif=True, champs_verrouilles=[])
        rows.append({c.key: getattr(e, c.key) for c in Entreprise.__table__.columns if getattr(e, c.key) is not None}
                    | {"recherche": texte_recherche(e), "score": 0, "categorie": "D", "score_detail": {}, "nb_fiches": 1,
                       "statut": "Active", "est_cliente": False, "absente_dernier_import": False})
    db.bulk_insert_mappings(Entreprise, rows)
    db.bulk_insert_mappings(Interaction, [{"entreprise_id": f"ENT-{rng.randint(1, 6000):05d}", "date": date.today() - timedelta(days=rng.randint(0, 120)),
                                           "type": "Appel", "tentative": 1, "joint": rng.random() < .5, "decideur_joint": False,
                                           "rdv_obtenu": rng.random() < .1, "commercial_id": fx[rng.randint(0, 2)], "action_faite": False,
                                           "date_prochaine_action": date.today() + timedelta(days=rng.randint(-10, 10))} for _ in range(10000)])
    recalculer(db)
    db.commit()
    c = connecter(app, "resp")
    for url, params in (("/api/entreprises", {}), ("/api/entreprises", {"q": "perf 59", "categorie": "A,B,C,D"}),
                        ("/api/entreprises", {"statut": "jointe", "region": "Dakar"}), ("/api/dashboard", {}),
                        ("/api/agenda", {}), ("/api/wallet", {}), ("/api/interactions", {})):
        t = time.perf_counter()
        r = c.get(url, params=params)
        duree = time.perf_counter() - t
        assert r.status_code == 200
        print(f"{url} {params} : {duree:.3f} s")
        assert duree < 2.0, f"{url} {params} : {duree:.2f} s"
    assert c.get("/api/dashboard").json()["volumes"]["interactions"] == 10000
