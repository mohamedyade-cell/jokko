"""Import (ou réimport) du classeur et de radar.db en ligne de commande.

Exemples :
    python scripts/importer.py --classeur SUNU_FX_SALES_RADAR.xlsx --radar moteur/data/radar.db
    python scripts/importer.py --classeur SUNU_FX_SALES_RADAR.xlsx --radar radar.db --simulation
L'import est idempotent : il peut être relancé sans créer de doublon.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal, init_engine  # noqa: E402
from app.importer.run import ImportRefuse, importer  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Import SUNU FX SALES RADAR")
    ap.add_argument("--classeur", type=Path, help="SUNU_FX_SALES_RADAR.xlsx")
    ap.add_argument("--radar", type=Path, help="moteur/data/radar.db")
    ap.add_argument("--utilisateur", default="admin-cli", help="nom tracé dans le journal d'audit")
    ap.add_argument("--simulation", action="store_true", help="calcule le rapport sans rien enregistrer")
    ap.add_argument("--rapport", type=Path, help="fichier JSON où écrire le rapport complet")
    a = ap.parse_args()
    for p in (a.classeur, a.radar):
        if p and not p.is_file():
            print(f"Fichier introuvable : {p}", file=sys.stderr)
            return 2
    init_engine()
    db = SessionLocal()
    try:
        rapport = importer(db, a.utilisateur, a.classeur, a.radar, simulation=a.simulation)
    except ImportRefuse as exc:
        print(f"IMPORT REFUSÉ : {exc}", file=sys.stderr)
        return 3
    finally:
        db.close()
    r = rapport["resume"]
    print("=== Rapport d'import" + (" (SIMULATION — rien n'a été enregistré)" if a.simulation else "") + " ===")
    for k, v in r.items():
        print(f"  {k} : {v}")
    print(f"  saisies : {json.dumps(rapport['saisies'], ensure_ascii=False)}")
    if rapport["colonnes_non_reconnues"]:
        print(f"  colonnes non reconnues : {json.dumps(rapport['colonnes_non_reconnues'], ensure_ascii=False)}")
    div = rapport["divergences_classeur"]
    print(f"  écarts avec les calculs du classeur : score {div.get('score', 0)}, catégorie {div.get('categorie', 0)}, vague {div.get('vague', 0)}")
    if a.rapport:
        a.rapport.write_text(json.dumps(rapport, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        print(f"Rapport complet : {a.rapport}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
