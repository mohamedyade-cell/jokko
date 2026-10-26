"""Scoring sur 100 points, catégorie A/B/C/D et vague — fonctions pures.

Barème (plafonds) : Import 20, Export 20, Intensité 15, Fréquence 15,
Couverture 10, Accessibilité 10, Potentiel 10.

Règle de priorité : une valeur confirmée en Qualification FX remplace
toujours l'hypothèse (base CCI, puis tables Segments / Tailles).
Chaque critère retourne ses points, son plafond et l'origine de la valeur
(« confirmé », « base », « segment », « taille »…), affichés dans la fiche 360°.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

PLAFONDS = {
    "import": 20,
    "export": 20,
    "intensite": 15,
    "frequence": 15,
    "couverture": 10,
    "accessibilite": 10,
    "potentiel": 10,
}

LIBELLES = {
    "import": "Import",
    "export": "Export",
    "intensite": "Intensité",
    "frequence": "Fréquence",
    "couverture": "Couverture",
    "accessibilite": "Accessibilité",
    "potentiel": "Potentiel",
}


@dataclass
class EntreeScore:
    segment: str | None = None
    taille: str | None = None
    import_hyp: bool | None = None
    export_hyp: bool | None = None
    telephone: str | None = None
    email: str | None = None
    contact_nom: str | None = None
    decideur_joint: bool = False
    qualification: dict[str, Any] | None = None
    segment_pts: dict[str, Any] = field(default_factory=dict)
    taille_pts: dict[str, Any] = field(default_factory=dict)


def _cap(value: float, cle: str) -> float:
    return max(0.0, min(float(value or 0), PLAFONDS[cle]))


def _crit(cle: str, points: float, origine: str, detail: str = "") -> dict:
    return {"critere": LIBELLES[cle], "points": round(_cap(points, cle), 2), "max": PLAFONDS[cle],
            "origine": origine, "detail": detail}


def _oui_non(flag: bool | None) -> str:
    return "Oui" if flag else "Non"


def calculer_score(e: EntreeScore, params: dict) -> dict:
    q = e.qualification or {}
    seg = e.segment_pts or {}
    tai = e.taille_pts or {}
    details: dict[str, dict] = {}

    for cle, conf, hyp, seg_key in (("import", "import_confirme", e.import_hyp, "import_pts"),
                                     ("export", "export_confirme", e.export_hyp, "export_pts")):
        if q.get(conf) is not None:
            details[cle] = _crit(cle, PLAFONDS[cle] if q[conf] else 0, "confirmé", f"Qualification : {_oui_non(q[conf])}")
        elif hyp is not None:
            details[cle] = _crit(cle, PLAFONDS[cle] if hyp else 0, "base", f"Base : {_oui_non(hyp)}")
        else:
            details[cle] = _crit(cle, seg.get(seg_key, 0), "segment", f"Hypothèse segment {e.segment or '—'}")

    vol = q.get("volume_annuel_fcfa")
    if vol is not None:
        pts = 0
        for seuil, p in sorted(params["intensite_paliers_fcfa"], key=lambda x: -x[0]):
            if vol >= seuil:
                pts = p
                break
        details["intensite"] = _crit("intensite", pts, "confirmé", f"Volume annuel confirmé : {vol:,.0f} FCFA".replace(",", " "))
    elif e.taille and tai:
        details["intensite"] = _crit("intensite", tai.get("intensite_pts", 0), "taille", f"Hypothèse taille {e.taille}")
    else:
        details["intensite"] = _crit("intensite", seg.get("intensite_pts", 0), "segment", f"Hypothèse segment {e.segment or '—'}")

    if q.get("frequence"):
        pts = params["frequence_points"].get(q["frequence"], 0)
        details["frequence"] = _crit("frequence", pts, "confirmé", f"Fréquence confirmée : {q['frequence']}")
    else:
        fs, ft = float(seg.get("frequence_pts", 0) or 0), float(tai.get("frequence_pts", 0) or 0)
        origine = "segment" if fs >= ft else "taille"
        details["frequence"] = _crit("frequence", max(fs, ft), origine, f"Max segment ({fs:g}) / taille ({ft:g})")

    produits = set(q.get("produits") or [])
    if q.get("besoin_confirme") is not None:
        pts = PLAFONDS["couverture"] if q["besoin_confirme"] else 0
        details["couverture"] = _crit("couverture", pts, "confirmé", f"Besoin de couverture confirmé : {_oui_non(q['besoin_confirme'])}")
    elif produits & {"Forward", "Flexiterme"}:
        details["couverture"] = _crit("couverture", PLAFONDS["couverture"], "confirmé", "Produit de couverture identifié")
    else:
        details["couverture"] = _crit("couverture", seg.get("couverture_pts", 0), "segment", f"Hypothèse segment {e.segment or '—'}")

    acc = params["accessibilite_points"]
    if e.decideur_joint:
        details["accessibilite"] = _crit("accessibilite", acc.get("decideur_joint", 10), "confirmé", "Décideur joint (Call Tracker)")
    else:
        pts, elems = 0.0, []
        if e.telephone:
            pts += acc.get("telephone", 0); elems.append("téléphone")
        if e.email:
            pts += acc.get("email", 0); elems.append("e-mail")
        if e.contact_nom:
            pts += acc.get("contact", 0); elems.append("contact nommé")
        details["accessibilite"] = _crit("accessibilite", pts, "base", ", ".join(elems) or "Aucun contact")

    if q.get("potentiel"):
        pts = params["potentiel_points"].get(q["potentiel"], 0)
        details["potentiel"] = _crit("potentiel", pts, "confirmé", f"Potentiel confirmé : {q['potentiel']}")
    elif e.segment and seg:
        details["potentiel"] = _crit("potentiel", seg.get("potentiel_pts", 0), "segment", f"Hypothèse segment {e.segment}")
    else:
        details["potentiel"] = _crit("potentiel", tai.get("potentiel_pts", 0), "taille", f"Hypothèse taille {e.taille or '—'}")

    total = sum(d["points"] for d in details.values())
    score = int(total + 0.5)  # arrondi commercial (ARRONDI Excel), pas l'arrondi bancaire de Python
    return {"score": score, "categorie": categorie(score, params), "criteres": details}


def categorie(score: float, params: dict) -> str:
    if score >= params["seuil_A"]:
        return "A"
    if score >= params["seuil_B"]:
        return "B"
    if score >= params["seuil_C"]:
        return "C"
    return "D"


def calculer_vague(*, segment: str | None, categorie_: str, taille: str | None, vague_manuelle: int | None,
                   vague_segment: int | None, params: dict) -> tuple[int, str]:
    """Règles de vague, dans l'ordre de priorité. Retourne (vague, règle appliquée)."""
    if vague_manuelle:
        return int(vague_manuelle), "Vague manuelle"
    if segment and segment == params["segment_banques"]:
        return 4, "Banques et établissements financiers → 4"
    if categorie_ == "A":
        return 1, "Catégorie A → 1"
    if (params.get("vague_grande_taille_active") and taille and taille == params["taille_grande"]
            and segment != params["segment_autres"]):
        return 1, "Taille Grande → 1"
    if categorie_ == "D":
        return 4, "Catégorie D → 4"
    if vague_segment:
        return int(vague_segment), "Vague par défaut du segment"
    return int(params["vague_defaut"]), "Vague par défaut (paramètre)"
