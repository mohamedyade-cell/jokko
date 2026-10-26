"""Corrections tracées des champs d'identité (avant, après, auteur, date, motif).

Tout champ corrigé est « verrouillé » : un import ultérieur ne l'écrase jamais.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from .models import VALIDATION_A_VERIFIER, VALIDATION_VALIDEE, Correction, Entreprise
from .services import CHAMPS_IDENTITE
from .utils import est_rccm, normaliser, ressemble_naema, texte, vers_bool, vers_float, vers_int

CHAMPS_ENTIERS = {"effectif"}
CHAMPS_DECIMAUX = {"chiffre_affaires", "capital"}
CHAMPS_BOOLEENS = {"import_hyp", "export_hyp"}


class CorrectionInvalide(ValueError):
    pass


def statut_validation(valeur: Any) -> str:
    b = vers_bool(valeur)
    if b is True or "valid" in normaliser(valeur):
        return VALIDATION_VALIDEE
    return VALIDATION_A_VERIFIER


def convertir(champ: str, valeur: Any) -> Any:
    if champ in CHAMPS_ENTIERS:
        return vers_int(valeur)
    if champ in CHAMPS_DECIMAUX:
        return vers_float(valeur)
    if champ in CHAMPS_BOOLEENS:
        return vers_bool(valeur)
    if champ == "statut_validation":
        return statut_validation(valeur)
    return texte(valeur)


def en_texte(valeur: Any) -> str | None:
    if valeur is None:
        return None
    if isinstance(valeur, bool):
        return "Oui" if valeur else "Non"
    if isinstance(valeur, float) and valeur.is_integer():
        return str(int(valeur))
    return str(valeur)


def verrouiller(e: Entreprise, champ: str) -> None:
    if champ not in (e.champs_verrouilles or []):
        e.champs_verrouilles = [*(e.champs_verrouilles or []), champ]


def controler(champ: str, valeur: Any) -> None:
    """Empêche de confondre RCCM et code NAEMA lors d'une saisie."""
    if valeur in (None, ""):
        return
    if champ == "rccm" and ressemble_naema(valeur) and not est_rccm(valeur):
        raise CorrectionInvalide("Cette valeur ressemble à un code NAEMA, pas à un RCCM (format SN-DKR-AAAA-X-NNNN).")
    if champ == "naema_code" and est_rccm(valeur):
        raise CorrectionInvalide("Cette valeur est un RCCM : saisissez-la dans le champ RCCM, pas dans NAEMA.")


def corriger(db: Session, e: Entreprise, champ: str, valeur: Any, auteur: str, motif: str | None = None,
             origine: str = "application", date: datetime | None = None, import_key: str | None = None) -> Correction | None:
    if champ not in CHAMPS_IDENTITE:
        raise CorrectionInvalide(f"Champ non corrigeable : {champ}")
    controler(champ, valeur)
    nouvelle = convertir(champ, valeur)
    ancienne = getattr(e, champ)
    verrouiller(e, champ)
    if ancienne == nouvelle:
        return None
    setattr(e, champ, nouvelle)
    c = Correction(entreprise_id=e.id, champ=champ, avant=en_texte(ancienne), apres=en_texte(nouvelle), auteur=auteur,
                   motif=motif, origine=origine, date=date or datetime.now().replace(microsecond=0), import_key=import_key)
    db.add(c)
    return c
