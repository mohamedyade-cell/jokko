"""Prépare une base de DÉMONSTRATION avec des données FICTIVES.

    RADAR_DATABASE_URL=sqlite:///./radar_demo.db python scripts/demo.py
Crée les comptes de démonstration (mot de passe affiché une seule fois), génère
le classeur et radar.db fictifs dans ./demo_fictif puis les importe.
Refuse de s'exécuter sur une base contenant des données réelles.
"""
from __future__ import annotations

import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal, init_engine  # noqa: E402
from app.demo import COMMERCIAUX, generer  # noqa: E402
from app.importer.run import importer  # noqa: E402
from app.models import Entreprise, Utilisateur  # noqa: E402
from app.security import hacher  # noqa: E402


def main() -> int:
    init_engine()
    db = SessionLocal()
    db.info["actor"] = "demo"
    if db.query(Entreprise).filter(Entreprise.fictif.is_(False)).first():
        print("Base contenant des données réelles : démonstration refusée.", file=sys.stderr)
        return 1
    mdp = "Demo-" + secrets.token_urlsafe(9) + "1"
    comptes = [("demo.resp", "Responsable Démo (FICTIF)", "responsable", None),
               ("demo.lecture", "Lecture Démo (FICTIF)", "lecture", None)]
    comptes += [(f"demo.fx{k}", nom, "fx_sales", nom) for k, nom in enumerate(COMMERCIAUX, start=1)]
    for login, nom, role, alias in comptes:
        if not db.query(Utilisateur).filter_by(login=login).first():
            db.add(Utilisateur(login=login, nom=nom, role=role, alias_classeur=alias, mot_de_passe_hash=hacher(mdp)))
    db.commit()
    xlsx, radar = generer(Path("demo_fictif"), n=int(sys.argv[1]) if len(sys.argv) > 1 else 600)
    rapport = importer(db, "demo", xlsx, radar)
    print(f"Jeu FICTIF importé : {rapport['resume']['entreprises_actives']} entreprises fictives.")
    print("Comptes : " + ", ".join(c[0] for c in comptes))
    print(f"Mot de passe commun (affiché une seule fois) : {mdp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
