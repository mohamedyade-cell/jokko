"""Outils de normalisation et de formatage (français)."""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timedelta

ID_REGEX = re.compile(r"^ENT-\d{5,}$")
# RCCM sénégalais : SN-DKR-2015-B-12345 (séparateurs tolérés)
RCCM_REGEX = re.compile(r"^SN[\s.\-/]*[A-Z]{3}[\s.\-/]*\d{4}[\s.\-/]*[A-Z][\s.\-/]*\d{1,6}$", re.I)
# Code NAEMA / NAF : 46.69, 4669, 46.69Z, G46.69…
NAEMA_REGEX = re.compile(r"^[A-Z]?\d{2}(\.?\d{1,2})?[A-Z]?$", re.I)
NINEA_REGEX = re.compile(r"^\d{7,9}(\s?[A-Z0-9]{3})?$", re.I)
EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)


def sans_accents(texte: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", texte) if not unicodedata.combining(c))


def normaliser(texte: object) -> str:
    if texte is None:
        return ""
    t = sans_accents(str(texte)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9@.+\- ]", " ", t)).strip()


def cle_colonne(texte: object) -> str:
    """Normalise un en-tête de colonne : « Téléphone 1 » → « telephone_1 »."""
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]", "_", sans_accents(str(texte or "")).lower())).strip("_")


def chiffres(texte: object) -> str:
    return re.sub(r"\D", "", str(texte or ""))


def telephone_normalise(texte: object) -> str:
    d = chiffres(texte)
    if d.startswith("00221"):
        d = d[5:]
    elif d.startswith("221") and len(d) == 12:
        d = d[3:]
    return d


def nom_normalise(texte: object) -> str:
    t = normaliser(texte)
    t = re.sub(r"\b(sa|sarl|suarl|sas|sasu|gie|ets|etablissements|societe|ste|ste\.|group|groupe|senegal|sn)\b", " ", t)
    return re.sub(r"[^a-z0-9]", "", t)


def ninea_normalise(texte: object) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(texte or "").upper())


def rccm_normalise(texte: object) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(texte or "").upper())


def est_rccm(texte: object) -> bool:
    return bool(texte) and bool(RCCM_REGEX.match(str(texte).strip()))


def ressemble_naema(texte: object) -> bool:
    return bool(texte) and bool(NAEMA_REGEX.match(str(texte).strip()))


def vers_bool(valeur: object) -> bool | None:
    if valeur is None:
        return None
    if isinstance(valeur, bool):
        return valeur
    if isinstance(valeur, (int, float)):
        return bool(valeur)
    t = normaliser(valeur)
    if t in {"oui", "o", "yes", "y", "vrai", "true", "x", "1", "confirme", "confirmé"}:
        return True
    if t in {"non", "n", "no", "faux", "false", "0"}:
        return False
    return None


def vers_float(valeur: object) -> float | None:
    if valeur is None or valeur == "":
        return None
    if isinstance(valeur, (int, float)):
        return float(valeur)
    t = str(valeur).replace(" ", "").replace("\xa0", "").replace(" ", "").replace("FCFA", "").replace("XOF", "")
    t = t.replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def vers_int(valeur: object) -> int | None:
    f = vers_float(valeur)
    return int(f) if f is not None else None


def vers_date(valeur: object) -> date | None:
    """Accepte date Excel, datetime, « jj/mm/aaaa », « aaaa-mm-jj » et numéro de série Excel."""
    if valeur is None or valeur == "":
        return None
    if isinstance(valeur, datetime):
        return valeur.date()
    if isinstance(valeur, date):
        return valeur
    if isinstance(valeur, (int, float)):
        if 20000 < valeur < 80000:
            return date(1899, 12, 30) + timedelta(days=int(valeur))
        return None
    t = str(valeur).strip()
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(t, fmt).date()
        except ValueError:
            continue
    return None


def date_fr(d: date | datetime | None) -> str:
    return d.strftime("%d/%m/%Y") if d else ""


def montant_fr(m: float | None, devise: str = "FCFA") -> str:
    if m is None:
        return ""
    s = f"{m:,.0f}".replace(",", " ")
    return f"{s} {devise}".strip()


def texte(valeur: object) -> str | None:
    if valeur is None:
        return None
    if isinstance(valeur, float) and valeur.is_integer():
        valeur = int(valeur)
    t = str(valeur).strip()
    return t or None
