"""Droits par rôle et journal d'audit."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.audit import AuditImmuableError
from app.models import Entreprise, JournalAudit


def _mes(db, user):
    return {e.id for e in db.query(Entreprise).filter_by(commercial_id=user.id)}


# --- Authentification -------------------------------------------------------------------------

def test_non_authentifie(app, imported):
    c = TestClient(app)
    assert c.get("/api/entreprises").status_code == 401
    assert c.post("/api/auth/login", json={"login": "resp", "mot_de_passe": "faux"}).status_code == 401


def test_csrf_entete_obligatoire(clients):
    c = clients["resp"]
    del c.headers["X-Radar"]
    assert c.put("/api/parametres/seuil_A", json={"valeur": 80}).status_code == 403
    c.headers["X-Radar"] = "1"


def test_blocage_apres_echecs(app, imported):
    c = TestClient(app)
    for _ in range(5):
        c.post("/api/auth/login", json={"login": "lect", "mot_de_passe": "faux"})
    assert c.post("/api/auth/login", json={"login": "lect", "mot_de_passe": "MotDePasse2026"}).status_code == 429


def test_mot_de_passe_hache(db, users):
    assert users["resp"].mot_de_passe_hash.startswith("pbkdf2_sha256$")
    assert "MotDePasse2026" not in users["resp"].mot_de_passe_hash


# --- FX Sales -------------------------------------------------------------------------------

def test_fx_sales_ne_voit_que_ses_entreprises(clients, db, users):
    mes = _mes(db, users["fx1"])
    assert mes
    r = clients["fx1"].get("/api/entreprises", params={"taille_page": 500}).json()
    assert {i["id"] for i in r["items"]} == mes
    autre = next(iter(_mes(db, users["fx2"])))
    assert clients["fx1"].get(f"/api/entreprises/{autre}").status_code == 403
    # le tableau de bord est limité à son portefeuille
    d = clients["fx1"].get("/api/dashboard").json()
    assert d["volumes"]["entreprises_uniques"] == len(mes)


def test_fx_sales_option_lecture_toute_base(clients, db, users):
    clients["resp"].put("/api/parametres/fx_sales_voit_toute_base", json={"valeur": True})
    autre = next(iter(_mes(db, users["fx2"])))
    assert clients["fx1"].get(f"/api/entreprises/{autre}").status_code == 200
    # … mais toujours pas de saisie sur l'entreprise d'un autre
    r = clients["fx1"].post("/api/interactions", json={"entreprise_id": autre, "date": date.today().isoformat(), "type": "Appel"})
    assert r.status_code == 403


def test_fx_sales_saisit_sur_ses_entreprises(clients, db, users):
    eid = sorted(_mes(db, users["fx1"]))[0]
    r = clients["fx1"].post("/api/interactions", json={"entreprise_id": eid, "date": date.today().isoformat(), "type": "Appel",
                                                       "joint": True, "prochaine_action": "Rappeler", "date_prochaine_action": date.today().isoformat()})
    assert r.status_code == 201, r.text
    iid = r.json()["id"]
    # un autre commercial ne peut ni modifier ni supprimer cette saisie
    assert clients["fx2"].delete(f"/api/interactions/{iid}").status_code == 403
    assert clients["fx1"].delete(f"/api/interactions/{iid}").status_code == 200


def test_fx_sales_interdits_responsable(clients):
    c = clients["fx1"]
    assert c.put("/api/parametres/seuil_A", json={"valeur": 80}).status_code == 403
    assert c.get("/api/utilisateurs").status_code == 403
    assert c.get("/api/audit").status_code == 403
    assert c.post("/api/wallet/attribuer", json={"ids": ["ENT-00001"], "commercial_id": 2}).status_code == 403
    assert c.post("/api/imports").status_code == 403


def test_fx_sales_ne_change_pas_attribution(clients, db, users):
    eid = sorted(_mes(db, users["fx1"]))[0]
    assert clients["fx1"].patch(f"/api/entreprises/{eid}", json={"commercial_id": users["fx2"].id}).status_code == 403


# --- Lecture seule ---------------------------------------------------------------------------------

def test_lecture_seule(clients):
    c = clients["lect"]
    assert c.get("/api/entreprises").json()["total"] == 200
    assert c.get("/api/dashboard").status_code == 200
    assert c.post("/api/interactions", json={"entreprise_id": "ENT-00001", "date": "2026-10-01", "type": "Appel"}).status_code == 403
    assert c.post("/api/entreprises/ENT-00001/corrections", json={"champ": "telephone", "valeur": "1"}).status_code == 403
    assert c.put("/api/entreprises/ENT-00001/qualification", json={}).status_code == 403
    assert c.put("/api/parametres/seuil_A", json={"valeur": 80}).status_code == 403


# --- Responsable ----------------------------------------------------------------------------------

def test_responsable_tout(clients, users):
    c = clients["resp"]
    assert c.get("/api/entreprises").json()["total"] == 200
    r = c.post("/api/wallet/attribuer", json={"ids": ["ENT-00001", "ENT-00002"], "commercial_id": users["fx3"].id})
    assert r.status_code == 200 and r.json()["attribuees"] == 2
    assert c.get("/api/utilisateurs").status_code == 200
    r = c.post("/api/utilisateurs", json={"login": "nouveau", "nom": "Nouveau", "role": "lecture", "mot_de_passe": "court"})
    assert r.status_code == 422  # politique de mot de passe


# --- Journal d'audit ------------------------------------------------------------------------------

def test_audit_creation_modification_suppression(clients, db, users):
    c = clients["resp"]
    r = c.post("/api/interactions", json={"entreprise_id": "ENT-00001", "date": "2026-10-20", "type": "Appel", "resultat": "Rappeler"})
    iid = str(r.json()["id"])
    j = db.query(JournalAudit).filter_by(table_cible="interactions", enregistrement_id=iid).all()
    assert [x.action for x in j] == ["CREATION"]
    assert j[0].utilisateur == "resp" and j[0].nouvelle_valeur["resultat"] == "Rappeler" and j[0].ancienne_valeur is None

    c.put(f"/api/interactions/{iid}", json={"entreprise_id": "ENT-00001", "date": "2026-10-20", "type": "Appel", "resultat": "Intéressé"})
    m = db.query(JournalAudit).filter_by(table_cible="interactions", enregistrement_id=iid, action="MODIFICATION").one()
    assert m.ancienne_valeur == {"resultat": "Rappeler"} and m.nouvelle_valeur == {"resultat": "Intéressé"}

    c.delete(f"/api/interactions/{iid}")
    s = db.query(JournalAudit).filter_by(table_cible="interactions", enregistrement_id=iid, action="SUPPRESSION").one()
    assert s.ancienne_valeur["resultat"] == "Intéressé" and s.nouvelle_valeur is None


def test_audit_correction_avant_apres(clients, db):
    r = clients["resp"].post("/api/entreprises/ENT-00002/corrections", json={"champ": "email", "valeur": "nouveau@fictif.example", "motif": "Test"})
    assert r.status_code == 200, r.text
    m = db.query(JournalAudit).filter_by(table_cible="entreprises", enregistrement_id="ENT-00002", action="MODIFICATION").order_by(JournalAudit.id.desc()).first()
    assert m.nouvelle_valeur["email"] == "nouveau@fictif.example" and m.ancienne_valeur["email"] == "contact2@fictif.example"
    assert "score" not in m.nouvelle_valeur  # champs dérivés exclus
    corr = clients["resp"].get("/api/qualite/corrections", params={"entreprise_id": "ENT-00002"}).json()[0]
    assert corr["avant"] == "contact2@fictif.example" and corr["apres"] == "nouveau@fictif.example" and corr["auteur"] == "resp"


def test_audit_rccm_naema_jamais_confondus(clients):
    r = clients["resp"].post("/api/entreprises/ENT-00002/corrections", json={"champ": "rccm", "valeur": "46.69"})
    assert r.status_code == 422
    r = clients["resp"].post("/api/entreprises/ENT-00002/corrections", json={"champ": "naema_code", "valeur": "SN-DKR-2015-B-12345"})
    assert r.status_code == 422


def test_audit_parametre_et_import(clients, db):
    clients["resp"].put("/api/parametres/objectif_couverture_pct", json={"valeur": 60})
    p = db.query(JournalAudit).filter_by(table_cible="parametres", enregistrement_id="objectif_couverture_pct").order_by(JournalAudit.id.desc()).first()
    assert p.utilisateur == "resp"
    assert db.query(JournalAudit).filter_by(action="IMPORT").count() == 1


def test_audit_ne_contient_pas_mot_de_passe(clients, db):
    clients["resp"].post("/api/utilisateurs", json={"login": "u2", "nom": "U2", "role": "lecture", "mot_de_passe": "UnMotDePasse2026"})
    j = db.query(JournalAudit).filter_by(table_cible="utilisateurs").order_by(JournalAudit.id.desc()).first()
    assert "mot_de_passe_hash" not in (j.nouvelle_valeur or {})
    assert "UnMotDePasse2026" not in str(j.nouvelle_valeur)


def test_audit_immuable(db, imported):
    j = db.query(JournalAudit).first()
    j.utilisateur = "pirate"
    with pytest.raises(AuditImmuableError):
        db.flush()
    db.rollback()
    db.delete(db.query(JournalAudit).first())
    with pytest.raises(AuditImmuableError):
        db.flush()
    db.rollback()


def test_entra_correspondance_compte(db, users):
    from fastapi import HTTPException

    from app.routers.auth import utilisateur_depuis_claims

    u = utilisateur_depuis_claims(db, {"oid": "oid-123", "preferred_username": "FX1@fictif.example"})
    assert u.login == "fx1" and u.entra_oid == "oid-123"
    assert utilisateur_depuis_claims(db, {"oid": "oid-123"}).login == "fx1"  # liaison par oid ensuite
    with pytest.raises(HTTPException):  # aucun compte créé automatiquement
        utilisateur_depuis_claims(db, {"oid": "x", "preferred_username": "inconnu@fictif.example"})
    users["fx2"].actif = False
    with pytest.raises(HTTPException):
        utilisateur_depuis_claims(db, {"preferred_username": "fx2@fictif.example"})
