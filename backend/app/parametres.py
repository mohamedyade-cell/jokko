"""Paramètres métier (modifiables par le Responsable Capital Market).

Les valeurs par défaut ci-dessous ne sont utilisées que si le classeur
(onglet Paramètres) ou l'écran Paramètres ne les définit pas.
Les valeurs marquées « RECONSTITUÉ » ont été déduites du cahier des charges
faute de disposer des formules exactes du classeur v2.4 : elles doivent être
vérifiées par le Responsable (voir docs/LIMITES.md).
"""
from __future__ import annotations

import copy
from typing import Any

from sqlalchemy.orm import Session

from .models import Parametre

ETAPES_PIPELINE_DEFAUT = [  # RECONSTITUÉ : 13 étapes, libellés à aligner sur le classeur
    {"nom": "1. Identifiée", "probabilite": 0},
    {"nom": "2. Attribuée", "probabilite": 0},
    {"nom": "3. Premier contact", "probabilite": 5},
    {"nom": "4. Jointe", "probabilite": 10},
    {"nom": "5. Décideur joint", "probabilite": 15},
    {"nom": "6. Qualifiée", "probabilite": 20},
    {"nom": "7. RDV planifié", "probabilite": 30},
    {"nom": "8. RDV réalisé", "probabilite": 40},
    {"nom": "9. Besoin confirmé", "probabilite": 50},
    {"nom": "10. Proposition / cotation", "probabilite": 60},
    {"nom": "11. Négociation", "probabilite": 75},
    {"nom": "12. Gagnée", "probabilite": 100, "gagnee": True},
    {"nom": "13. Perdue", "probabilite": 0, "perdue": True},
]

DEFAUTS: dict[str, Any] = {
    "seuil_A": 75,
    "seuil_B": 55,
    "seuil_C": 35,
    "objectif_couverture_pct": 50,
    "objectif_duree_mois": 6,
    "date_lancement": None,  # jj/mm/aaaa ou ISO ; à défaut : date du premier import
    "vague_grande_taille_active": True,
    "segment_banques": "Banques et établissements financiers",
    "segment_autres": "Autres secteurs",
    "taille_grande": "Grande",
    "vague_defaut": 3,  # si le segment n'a pas de vague par défaut
    "vagues_lancees": [1],
    "marge_pb_defaut": 25,
    "taux_change": {"XOF": 1, "EUR": 655.957, "USD": 600, "GBP": 760, "CNY": 83, "JPY": 4},
    "etapes_pipeline": ETAPES_PIPELINE_DEFAUT,
    # Barèmes de remplacement des hypothèses par les valeurs confirmées (RECONSTITUÉ)
    "intensite_paliers_fcfa": [  # volume annuel FX confirmé → points (max 15)
        [5_000_000_000, 15], [1_000_000_000, 12], [500_000_000, 9], [100_000_000, 6], [0, 3],
    ],
    "frequence_points": {"Quotidienne": 15, "Hebdomadaire": 12, "Mensuelle": 9, "Trimestrielle": 5, "Ponctuelle": 2},
    "potentiel_points": {"Élevé": 10, "Moyen": 6, "Faible": 2},
    "accessibilite_points": {"telephone": 4, "email": 3, "contact": 3, "decideur_joint": 10},
    "echantillon_taille": 30,
    "fx_sales_voit_toute_base": False,
    "devises": ["EUR", "USD", "GBP", "CNY", "JPY", "XOF", "Autre"],
    "resultats_appel": [
        "Pas de réponse", "Mauvais numéro", "Rappeler", "Intéressé", "Pas intéressé",
        "RDV fixé", "Déjà client", "Envoi documentation", "Autre",
    ],
}

DESCRIPTIONS = {
    "seuil_A": "Score minimal catégorie A",
    "seuil_B": "Score minimal catégorie B",
    "seuil_C": "Score minimal catégorie C (en dessous : D)",
    "objectif_couverture_pct": "Objectif de couverture de la base validée (%)",
    "objectif_duree_mois": "Durée de l'objectif de couverture (mois)",
    "date_lancement": "Date de lancement de la campagne (jj/mm/aaaa)",
    "vague_grande_taille_active": "Taille « Grande » → vague 1 (hors « Autres secteurs »)",
    "vagues_lancees": "Vagues lancées (entreprises ciblées)",
    "marge_pb_defaut": "Marge par défaut (points de base)",
    "taux_change": "Taux de conversion en FCFA",
    "etapes_pipeline": "Étapes du pipeline et probabilités",
    "echantillon_taille": "Taille de l'échantillon de contrôle qualité",
    "fx_sales_voit_toute_base": "Les FX Sales voient toute la base en lecture",
}


def charger(db: Session) -> dict[str, Any]:
    params = copy.deepcopy(DEFAUTS)
    for p in db.query(Parametre).all():
        params[p.cle] = p.valeur
    return params


def definir(db: Session, cle: str, valeur: Any) -> None:
    if cle not in DEFAUTS:
        raise KeyError(f"Paramètre inconnu : {cle}")
    p = db.get(Parametre, cle)
    if p is None:
        db.add(Parametre(cle=cle, valeur=valeur))
    elif p.valeur != valeur:
        p.valeur = valeur


def etape_gagnee(params: dict) -> str:
    for e in params["etapes_pipeline"]:
        if e.get("gagnee"):
            return e["nom"]
    return params["etapes_pipeline"][-2]["nom"]


def etape_perdue(params: dict) -> str:
    for e in params["etapes_pipeline"]:
        if e.get("perdue"):
            return e["nom"]
    return params["etapes_pipeline"][-1]["nom"]


def taux_fcfa(params: dict, devise: str | None) -> float:
    return float(params["taux_change"].get((devise or "XOF").upper(), 1) or 1)
