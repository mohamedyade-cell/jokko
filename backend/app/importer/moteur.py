"""Lecture de la base du moteur d'extraction (moteur/data/radar.db), en lecture seule.

Tables attendues : files, sources, entity_map, entity_alias. Les noms de
colonnes sont détectés parmi plusieurs variantes ; une colonne introuvable
est signalée dans le rapport d'import.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

COL_FILE_ID = ["id", "file_id", "fichier_id"]
COL_FILE_NOM = ["filename", "file_name", "nom", "name", "path", "chemin", "fichier", "relpath"]
COL_FILE_PAGES = ["pages", "nb_pages", "page_count", "n_pages"]
COL_SRC_ID = ["id", "source_id", "fiche_id"]
COL_SRC_FILE = ["file_id", "fichier_id", "files_id", "pdf_id"]
COL_SRC_PAGE = ["page", "page_no", "page_num", "numero_page", "page_number"]
COL_MAP_SRC = ["source_id", "fiche_id", "id_source", "src_id"]
COL_MAP_ENT = ["entity_id", "entreprise_id", "ent_id", "id_entreprise"]
COL_ALIAS_OLD = ["old_id", "alias_id", "ancien_id", "alias", "from_id", "source_entity_id", "old_entity_id"]
COL_ALIAS_NEW = ["new_id", "canonical_id", "nouvel_id", "to_id", "target_id", "entity_id", "new_entity_id"]


@dataclass
class DonneesMoteur:
    fichiers: list[dict] = field(default_factory=list)  # id, nom, chemin, nb_pages
    fiches: list[dict] = field(default_factory=list)  # id, fichier_id, page, entreprise_id, donnees
    alias: dict[str, str] = field(default_factory=dict)
    anomalies: list[str] = field(default_factory=list)


def _cols(con: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in con.execute(f'PRAGMA table_info("{table}")')]


def _pick(cols: list[str], candidates: list[str]) -> str | None:
    low = {c.lower(): c for c in cols}
    for c in candidates:
        if c in low:
            return low[c]
    return None


def lire_moteur(chemin: str | Path) -> DonneesMoteur:
    chemin = Path(chemin)
    out = DonneesMoteur()
    con = sqlite3.connect(f"file:{chemin.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        tables = {r[0].lower(): r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}

        if "files" in tables:
            cols = _cols(con, tables["files"])
            cid, cnom, cpages = _pick(cols, COL_FILE_ID), _pick(cols, COL_FILE_NOM), _pick(cols, COL_FILE_PAGES)
            if cid is None:
                out.anomalies.append("Table files : colonne identifiant introuvable")
            else:
                for r in con.execute(f'SELECT * FROM "{tables["files"]}"'):
                    chem = str(r[cnom]) if cnom and r[cnom] is not None else None
                    out.fichiers.append({"id": int(r[cid]), "nom": Path(chem).name if chem else f"fichier-{r[cid]}",
                                         "chemin": chem, "nb_pages": r[cpages] if cpages else None})
        else:
            out.anomalies.append("Table files absente de radar.db")

        mapping: dict[int, str] = {}
        if "entity_map" in tables:
            cols = _cols(con, tables["entity_map"])
            cs, ce = _pick(cols, COL_MAP_SRC), _pick(cols, COL_MAP_ENT)
            if cs and ce:
                for r in con.execute(f'SELECT "{cs}", "{ce}" FROM "{tables["entity_map"]}"'):
                    if r[0] is not None and r[1]:
                        mapping[int(r[0])] = str(r[1]).strip()
            else:
                out.anomalies.append("Table entity_map : colonnes source/entité introuvables")
        else:
            out.anomalies.append("Table entity_map absente de radar.db")

        if "sources" in tables:
            cols = _cols(con, tables["sources"])
            cid, cfile, cpage = _pick(cols, COL_SRC_ID), _pick(cols, COL_SRC_FILE), _pick(cols, COL_SRC_PAGE)
            cent = _pick(cols, COL_MAP_ENT)
            if cid is None:
                out.anomalies.append("Table sources : colonne identifiant introuvable")
            else:
                techniques = {c for c in (cid, cfile, cpage, cent) if c}
                for r in con.execute(f'SELECT * FROM "{tables["sources"]}"'):
                    sid = int(r[cid])
                    ent = mapping.get(sid) or (str(r[cent]).strip() if cent and r[cent] else None)
                    out.fiches.append({
                        "id": sid,
                        "fichier_id": int(r[cfile]) if cfile and r[cfile] is not None else None,
                        "page": int(r[cpage]) if cpage and r[cpage] is not None else None,
                        "entreprise_id": ent,
                        "donnees": {k: r[k] for k in r.keys() if k not in techniques and r[k] not in (None, "")},
                    })
        else:
            out.anomalies.append("Table sources absente de radar.db")

        if "entity_alias" in tables:
            cols = _cols(con, tables["entity_alias"])
            co, cn = _pick(cols, COL_ALIAS_OLD), _pick(cols, COL_ALIAS_NEW)
            if co and cn and co != cn:
                for r in con.execute(f'SELECT "{co}", "{cn}" FROM "{tables["entity_alias"]}"'):
                    if r[0] and r[1] and str(r[0]).strip() != str(r[1]).strip():
                        out.alias[str(r[0]).strip()] = str(r[1]).strip()
            else:
                out.anomalies.append("Table entity_alias : colonnes ancien/nouvel ID introuvables")
    finally:
        con.close()
    return out
