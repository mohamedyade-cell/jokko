"""Création d'un compte (premier Responsable notamment).

    python scripts/creer_utilisateur.py --login resp --nom "Prénom Nom" --role responsable --email prenom.nom@sunu.sn
Le mot de passe est demandé de façon masquée (jamais passé en argument).
"""
from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal, init_engine  # noqa: E402
from app.models import ROLES, Utilisateur  # noqa: E402
from app.security import hacher, mot_de_passe_valide  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--login", required=True)
    ap.add_argument("--nom", required=True)
    ap.add_argument("--role", required=True, choices=ROLES)
    ap.add_argument("--email")
    ap.add_argument("--alias-classeur", help="nom du commercial tel qu'écrit dans le classeur (séparés par ;)")
    ap.add_argument("--sans-mot-de-passe", action="store_true", help="compte Microsoft 365 uniquement")
    a = ap.parse_args()
    init_engine()
    db = SessionLocal()
    db.info["actor"] = "admin-cli"
    login = a.login.strip().lower()
    if db.query(Utilisateur).filter_by(login=login).first():
        print("Identifiant déjà utilisé", file=sys.stderr)
        return 1
    u = Utilisateur(login=login, nom=a.nom, role=a.role, email=(a.email or "").lower() or None, alias_classeur=a.alias_classeur)
    if not a.sans_mot_de_passe:
        mdp = getpass.getpass("Mot de passe : ")
        if err := mot_de_passe_valide(mdp):
            print(err, file=sys.stderr)
            return 1
        if getpass.getpass("Confirmation : ") != mdp:
            print("Les mots de passe diffèrent", file=sys.stderr)
            return 1
        u.mot_de_passe_hash = hacher(mdp)
    db.add(u)
    db.commit()
    print(f"Compte créé : {login} ({a.role})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
