"""Journal d'audit automatique.

Chaque création, modification et suppression d'un enregistrement métier passant
par l'ORM est journalisée avec l'utilisateur, l'horodatage, l'ancienne et la
nouvelle valeur. Le journal est en ajout seul : toute tentative de modification
ou de suppression d'une ligne d'audit via l'ORM lève une erreur.

Ne sont pas journalisés champ par champ :
- les champs dérivés recalculés automatiquement (score, catégorie, vague, texte de recherche) ;
- les données techniques du moteur (fiches PDF, provenances, fichiers), tracées
  globalement par une entrée « IMPORT » contenant le rapport d'import.
"""
from __future__ import annotations

import enum
from datetime import date, datetime
from typing import Any

from sqlalchemy import event, insert, inspect
from sqlalchemy.orm import Session

from .db import current_actor
from .models import (
    Correction,
    Entreprise,
    EntiteAlias,
    Interaction,
    JournalAudit,
    Objectif,
    Opportunite,
    PaireDoublon,
    Parametre,
    Qualification,
    Segment,
    Taille,
    Utilisateur,
)

AUDITED = (
    Entreprise,
    Interaction,
    Qualification,
    Opportunite,
    Correction,
    PaireDoublon,
    Segment,
    Taille,
    Parametre,
    Objectif,
    Utilisateur,
    EntiteAlias,
)

IGNORED_FIELDS = {
    "score",
    "score_detail",
    "categorie",
    "vague",
    "vague_regle",
    "recherche",
    "modifie_le",
    "cree_le",
    "mot_de_passe_hash",  # jamais exposé, même haché
}


class AuditImmuableError(RuntimeError):
    pass


def _serialize(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, (list, tuple)):
        return [_serialize(v) for v in value]
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    return value


def _pk(obj) -> str:
    identity = inspect(obj).identity
    if identity:
        return "/".join(str(v) for v in identity)
    mapper = inspect(obj).mapper
    return "/".join(str(getattr(obj, c.key)) for c in mapper.primary_key)


def _snapshot(obj) -> dict:
    mapper = inspect(obj).mapper
    data = {}
    for attr in mapper.column_attrs:
        if attr.key in IGNORED_FIELDS:
            continue
        data[attr.key] = _serialize(getattr(obj, attr.key))
    if "mot_de_passe_hash" in {a.key for a in mapper.column_attrs}:
        data["mot_de_passe_defini"] = getattr(obj, "mot_de_passe_hash") is not None
    return data


def _changes(obj) -> tuple[dict, dict]:
    state = inspect(obj)
    old, new = {}, {}
    for attr in state.mapper.column_attrs:
        hist = state.attrs[attr.key].history
        if not hist.has_changes():
            continue
        before = hist.deleted[0] if hist.deleted else None
        after = hist.added[0] if hist.added else None
        if before == after:
            continue
        if attr.key == "mot_de_passe_hash":
            old["mot_de_passe"] = "****"
            new["mot_de_passe"] = "modifié"
            continue
        if attr.key in IGNORED_FIELDS:
            continue
        old[attr.key] = _serialize(before)
        new[attr.key] = _serialize(after)
    return old, new


def _before_flush(session: Session, _ctx, _instances) -> None:
    for obj in list(session.dirty) + list(session.deleted):
        if isinstance(obj, JournalAudit):
            raise AuditImmuableError("Le journal d'audit est en ajout seul : modification ou suppression interdite.")


def _after_flush(session: Session, _ctx) -> None:
    rows = []
    now = datetime.now().replace(microsecond=0)
    actor = session.info.get("actor") or current_actor.get()
    for obj in session.new:
        if isinstance(obj, AUDITED):
            rows.append(dict(horodatage=now, utilisateur=actor, action="CREATION", table_cible=obj.__tablename__,
                             enregistrement_id=_pk(obj), ancienne_valeur=None, nouvelle_valeur=_snapshot(obj)))
    for obj in session.dirty:
        if isinstance(obj, AUDITED) and session.is_modified(obj, include_collections=False):
            old, new = _changes(obj)
            if new or old:
                rows.append(dict(horodatage=now, utilisateur=actor, action="MODIFICATION", table_cible=obj.__tablename__,
                                 enregistrement_id=_pk(obj), ancienne_valeur=old, nouvelle_valeur=new))
    for obj in session.deleted:
        if isinstance(obj, AUDITED):
            rows.append(dict(horodatage=now, utilisateur=actor, action="SUPPRESSION", table_cible=obj.__tablename__,
                             enregistrement_id=_pk(obj), ancienne_valeur=_snapshot(obj), nouvelle_valeur=None))
    if rows:
        session.connection().execute(insert(JournalAudit.__table__), rows)


def journaliser(session: Session, action: str, table: str, enregistrement_id: str,
                ancienne: dict | None = None, nouvelle: dict | None = None) -> None:
    """Entrée d'audit explicite (import, opération en masse, export…)."""
    session.connection().execute(insert(JournalAudit.__table__), [dict(
        horodatage=datetime.now().replace(microsecond=0),
        utilisateur=session.info.get("actor") or current_actor.get(),
        action=action, table_cible=table, enregistrement_id=enregistrement_id,
        ancienne_valeur=_serialize(ancienne) if ancienne is not None else None,
        nouvelle_valeur=_serialize(nouvelle) if nouvelle is not None else None,
    )])


_installed = False


def install_audit() -> None:
    global _installed
    if _installed:
        return
    event.listen(Session, "before_flush", _before_flush)
    event.listen(Session, "after_flush", _after_flush)
    _installed = True
