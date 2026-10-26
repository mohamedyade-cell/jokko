"""Import idempotent du classeur SUNU_FX_SALES_RADAR.xlsx et de radar.db.

Garanties :
1. Aucun ID n'est créé par l'application ni supprimé : une entreprise absente
   d'une nouvelle version est conservée et signalée.
2. Les alias du moteur (ancien ID → nouvel ID) sont appliqués aux saisies du
   classeur et aux saisies déjà présentes dans l'application.
3. Une saisie utilisateur n'est jamais écrasée : champs verrouillés après
   correction ou attribution, saisies déjà présentes ignorées (clé d'import).
4. Relancer l'import avec les mêmes fichiers ne crée aucun doublon.
"""
from __future__ import annotations

import hashlib
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from .. import doublons as D
from .. import parametres as P
from ..audit import journaliser
from ..corrections import CorrectionInvalide, convertir, corriger, statut_validation
from ..models import (
    DECISION_DISTINCTES,
    DECISION_DOUBLON,
    PRODUITS_FX,
    STATUT_ACTIVE,
    STATUT_FUSIONNEE,
    TYPES_INTERACTION,
    Correction,
    Entreprise,
    EntiteAlias,
    ExecutionImport,
    Fiche,
    FichierPdf,
    Interaction,
    Opportunite,
    PaireDoublon,
    Parametre,
    ProvenanceChamp,
    Qualification,
    Segment,
    Taille,
    Utilisateur,
)
from ..services import CHAMPS_IDENTITE, recalculer, resoudre_alias
from ..utils import (
    ID_REGEX,
    cle_colonne,
    est_rccm,
    normaliser,
    ressemble_naema,
    texte,
    vers_bool,
    vers_date,
    vers_float,
    vers_int,
)
from . import colonnes as C
from .classeur import Classeur
from .moteur import lire_moteur

MAX_LISTE = 500  # nombre maximal d'éléments détaillés par liste dans le rapport


class ImportRefuse(RuntimeError):
    pass


class Rapport:
    def __init__(self) -> None:
        self.data: dict[str, Any] = {
            "resume": {},
            "nouvelles_entreprises": [],
            "ids_fusionnes": [],
            "absentes": [],
            "anomalies": [],
            "saisies": {},
            "colonnes_non_reconnues": {},
            "parametres": {"importes": [], "conserves_application": []},
            "divergences_classeur": {},
        }
        self.compteurs: Counter = Counter()

    def anomalie(self, type_: str, message: str, onglet: str | None = None, ligne: int | None = None,
                 entreprise_id: str | None = None) -> None:
        self.compteurs[f"anomalie:{type_}"] += 1
        if len(self.data["anomalies"]) < 5000:
            self.data["anomalies"].append({"type": type_, "message": message, "onglet": onglet, "ligne": ligne,
                                           "entreprise_id": entreprise_id})

    def ajouter(self, cle: str, valeur: Any) -> None:
        if len(self.data[cle]) < MAX_LISTE:
            self.data[cle].append(valeur)

    def saisie(self, onglet: str, cle: str, n: int = 1) -> None:
        self.data["saisies"].setdefault(onglet, Counter())[cle] += n

    def finaliser(self) -> dict:
        self.data["saisies"] = {k: dict(v) for k, v in self.data["saisies"].items()}
        types = Counter(a["type"] for a in self.data["anomalies"])
        self.data["resume"]["anomalies_par_type"] = dict(types)
        self.data["resume"]["nb_anomalies"] = sum(v for k, v in self.compteurs.items() if k.startswith("anomalie:"))
        return self.data


def _cle(*parts: Any) -> str:
    return hashlib.sha1("|".join("" if p is None else str(p) for p in parts).encode("utf-8")).hexdigest()


def _empreinte(*chemins: Path | None) -> str:
    h = hashlib.sha256()
    for c in chemins:
        if c and c.exists():
            h.update(c.read_bytes())
    return h.hexdigest()[:32]


class Importeur:
    def __init__(self, db: Session, utilisateur: str, classeur: str | Path | None = None,
                 radar_db: str | Path | None = None, rapport: Rapport | None = None):
        self.db = db
        self.utilisateur = utilisateur
        self.classeur_path = Path(classeur) if classeur else None
        self.radar_path = Path(radar_db) if radar_db else None
        self.r = rapport or Rapport()
        self.alias: dict[str, str] = {}
        self.params = P.charger(db)
        self.utilisateurs = self._index_utilisateurs()
        self.fictif = False
        self.recalcul_complet = True

    # -- utilitaires ------------------------------------------------------------------
    def _index_utilisateurs(self) -> dict[str, Utilisateur]:
        idx: dict[str, Utilisateur] = {}
        for u in self.db.query(Utilisateur).filter(Utilisateur.actif.is_(True)):
            for k in (u.login, u.nom, u.alias_classeur, u.email):
                if k:
                    for part in str(k).split(";"):
                        idx.setdefault(normaliser(part), u)
        return idx

    def _commercial(self, nom: Any, onglet: str, ligne: int | None) -> Utilisateur | None:
        if nom in (None, ""):
            return None
        u = self.utilisateurs.get(normaliser(nom))
        if u is None:
            self.r.anomalie("commercial_inconnu", f"Commercial « {nom} » sans compte utilisateur (créez le compte ou renseignez son alias classeur)", onglet, ligne)
        return u

    def _id(self, valeur: Any, onglet: str, ligne: int | None) -> str | None:
        eid = texte(valeur)
        if not eid:
            self.r.anomalie("id_manquant", "ID entreprise manquant", onglet, ligne)
            return None
        eid = eid.upper()
        nouvel = resoudre_alias(self.alias, eid)
        if nouvel != eid:
            self.r.compteurs["saisies_realignees"] += 1
            self.r.saisie(onglet, "id_realigne_par_alias")
        if self.db.get(Entreprise, nouvel) is None:
            self.r.anomalie("id_inconnu", f"ID {eid} inconnu de la base", onglet, ligne, eid)
            return None
        return nouvel

    # -- étapes -------------------------------------------------------------------------
    def executer(self, simulation: bool = False) -> dict:
        if not self.classeur_path and not self.radar_path:
            raise ImportRefuse("Indiquez au moins le classeur ou radar.db")
        debut = datetime.now().replace(microsecond=0)
        self.db.info["actor"] = f"import:{self.utilisateur}"
        moteur = lire_moteur(self.radar_path) if self.radar_path else None
        classeur = Classeur(self.classeur_path) if self.classeur_path else None
        if moteur:
            for a in moteur.anomalies:
                self.r.anomalie("moteur", a, "radar.db")
        if classeur:
            self._parametres(classeur)
            self._controle_fictif()
            self._scoring(classeur)
            self.params = P.charger(self.db)
        self._alias(moteur)
        if classeur:
            self._base(classeur)
        if moteur:
            self._fiches(moteur)
        self._appliquer_alias_existants()
        if classeur:
            self._corrections(classeur)
            self._call_tracker(classeur)
            self._qualification(classeur)
            self._pipeline(classeur)
            self._doublons(classeur)
        self.db.flush()
        self.r.data["resume"]["entreprises_recalculees"] = recalculer(self.db, params=self.params)
        self.db.flush()
        self._divergences()
        self.r.data["resume"]["doublons"] = D.detecter(self.db)
        self._resume()
        rapport = self.r.finaliser()
        run = ExecutionImport(debut=debut, fin=datetime.now().replace(microsecond=0), utilisateur=self.utilisateur,
                              fichier_excel=str(self.classeur_path) if self.classeur_path else None,
                              fichier_db=str(self.radar_path) if self.radar_path else None,
                              empreinte=_empreinte(self.classeur_path, self.radar_path),
                              statut="simulation" if simulation else "terminé", rapport=rapport)
        if simulation:
            self.db.rollback()
            return rapport
        self.db.add(run)
        self.db.flush()
        journaliser(self.db, "IMPORT", "imports", str(run.id), None, rapport["resume"])
        self.db.commit()
        rapport["import_id"] = run.id
        return rapport

    def _parametres(self, classeur: Classeur) -> None:
        valeurs, inconnus = classeur.parametres()
        if inconnus:
            self.r.data["colonnes_non_reconnues"]["Paramètres"] = inconnus[:100]
        jeu = valeurs.pop("jeu_de_donnees", None)
        self.fictif = normaliser(jeu) == "fictif"
        existants = {p.cle for p in self.db.query(Parametre)}
        for cle, brut in valeurs.items():
            valeur = self._convertir_param(cle, brut)
            if valeur is None:
                self.r.anomalie("parametre_invalide", f"Valeur illisible pour {cle} : {brut!r}", "Paramètres")
                continue
            if cle in existants:
                # Le paramètre a déjà été défini (import précédent ou écran Paramètres) : on ne l'écrase pas.
                if self.db.get(Parametre, cle).valeur != valeur:
                    self.r.data["parametres"]["conserves_application"].append(cle)
                continue
            P.definir(self.db, cle, valeur)
            self.r.data["parametres"]["importes"].append(cle)

    @staticmethod
    def _convertir_param(cle: str, brut: Any) -> Any:
        if cle in {"seuil_A", "seuil_B", "seuil_C", "objectif_duree_mois", "marge_pb_defaut"}:
            return vers_float(brut)
        if cle == "objectif_couverture_pct":
            v = vers_float(str(brut).replace("%", "")) if brut is not None else None
            return v * 100 if v is not None and v <= 1 else v
        if cle == "date_lancement":
            d = vers_date(brut)
            return d.isoformat() if d else None
        if cle == "vagues_lancees":
            if isinstance(brut, (int, float)):
                # Un nombre seul n = « vagues 1 à n lancées » (interprétation signalée dans LIMITES.md)
                return list(range(1, int(brut) + 1))
            vals = [vers_int(x) for x in str(brut).replace(";", ",").replace("+", ",").split(",")]
            return [v for v in vals if v] or None
        if cle == "vague_grande_taille_active":
            return vers_bool(brut)
        return brut

    def _controle_fictif(self) -> None:
        if self.db.query(Entreprise).count() == 0:
            return
        fictives = self.db.query(Entreprise).filter(Entreprise.fictif.is_(True)).count()
        reelles = self.db.query(Entreprise).filter(Entreprise.fictif.is_(False)).count()
        if self.fictif and reelles:
            raise ImportRefuse("Import refusé : jeu de démonstration FICTIF dans une base contenant des données réelles.")
        if not self.fictif and fictives:
            raise ImportRefuse("Import refusé : données réelles dans une base de démonstration FICTIVE. Utilisez une base dédiée.")

    def _scoring(self, classeur: Classeur) -> None:
        segs, tailles = classeur.tables_scoring()
        if not segs.trouvee:
            self.r.anomalie("scoring", "Table Segments introuvable dans l'onglet Scoring", "Scoring")
        if not tailles.trouvee:
            self.r.anomalie("scoring", "Table Tailles introuvable dans l'onglet Scoring", "Scoring")
        for table, modele, nom_onglet in ((segs, Segment, "Scoring/Segments"), (tailles, Taille, "Scoring/Tailles")):
            if table.non_reconnues:
                self.r.data["colonnes_non_reconnues"][nom_onglet] = table.non_reconnues
            crees, conserves = 0, 0
            for ligne in table.lignes:
                nom = texte(ligne.get("nom"))
                if not nom:
                    continue
                valeurs = {}
                for k, v in ligne.items():
                    if k in {"nom", "_ligne"}:
                        continue
                    if k == "accroche":
                        valeurs[k] = texte(v)
                    elif k in {"vague_defaut", "ordre"}:
                        valeurs[k] = vers_int(v)
                    else:
                        valeurs[k] = vers_float(v) or 0.0
                obj = self.db.get(modele, nom)
                if obj is None:
                    self.db.add(modele(nom=nom, **valeurs))
                    crees += 1
                elif any(getattr(obj, k) != v for k, v in valeurs.items()):
                    conserves += 1  # modifié dans l'application : conservé
            self.r.data["resume"][f"{nom_onglet}_crees"] = crees
            if conserves:
                self.r.data["resume"][f"{nom_onglet}_conserves_application"] = conserves
        self.db.flush()

    def _alias(self, moteur) -> None:
        existants = {a.ancien_id: a for a in self.db.query(EntiteAlias)}
        crees = 0
        if moteur:
            for ancien, nouvel in moteur.alias.items():
                a = existants.get(ancien)
                if a is None:
                    a = EntiteAlias(ancien_id=ancien, nouvel_id=nouvel, origine="moteur")
                    self.db.add(a)
                    existants[ancien] = a
                    crees += 1
                elif a.nouvel_id != nouvel and a.origine == "moteur":
                    a.nouvel_id = nouvel
        self.db.flush()
        self.alias = {a.ancien_id: a.nouvel_id for a in existants.values()}
        for ancien in list(self.alias):
            vus, cur = {ancien}, self.alias[ancien]
            while cur in self.alias:
                if cur in vus:
                    self.r.anomalie("alias_cycle", f"Cycle d'alias détecté à partir de {ancien}", "radar.db", None, ancien)
                    del self.alias[ancien]
                    break
                vus.add(cur)
                cur = self.alias[cur]
        self.r.data["resume"]["alias_moteur_nouveaux"] = crees

    def _base(self, classeur: Classeur) -> None:
        table = classeur.table("base", C.BASE)
        if not table.trouvee:
            self.r.anomalie("onglet_absent", "Onglet Base introuvable ou en-têtes non reconnus", "Base")
            return
        if table.non_reconnues:
            self.r.data["colonnes_non_reconnues"]["Base"] = table.non_reconnues
        existantes = {e.id: e for e in self.db.query(Entreprise)}
        vus: set[str] = set()
        champs_modele = set(CHAMPS_IDENTITE) | {"nb_fiches", "score_classeur", "categorie_classeur", "vague_classeur",
                                                 "vague_manuelle", "est_cliente"}
        maj = inchangees = protegees = 0
        today = date.today()
        for ligne in table.lignes:
            n = ligne["_ligne"]
            eid = (texte(ligne.get("id")) or "").upper()
            if not ID_REGEX.match(eid):
                self.r.anomalie("id_invalide", f"ID absent ou invalide : {ligne.get('id')!r}", "Base", n)
                continue
            if eid in vus:
                self.r.anomalie("id_duplique", f"ID {eid} présent plusieurs fois dans Base (première ligne conservée)", "Base", n, eid)
                continue
            vus.add(eid)
            if eid in self.alias:
                self.r.anomalie("id_ancien_dans_base", f"{eid} est un ancien ID (alias vers {self.alias[eid]}) mais figure encore dans Base", "Base", n, eid)
            valeurs = self._valeurs_base(ligne, n, eid)
            e = existantes.get(eid)
            if e is None:
                e = Entreprise(id=eid, fictif=self.fictif, statut=STATUT_ACTIVE, champs_verrouilles=[], **valeurs)
                u = self._commercial(ligne.get("commercial"), "Base", n)
                if u:
                    e.commercial_id, e.date_attribution = u.id, today
                self.db.add(e)
                existantes[eid] = e
                self.r.ajouter("nouvelles_entreprises", eid)
                self.r.compteurs["nouvelles"] += 1
                continue
            verrous = set(e.champs_verrouilles or [])
            change = False
            for champ, v in valeurs.items():
                if champ not in champs_modele:
                    continue
                if champ == "est_cliente" and not v:
                    continue  # le statut client acquis dans l'application n'est jamais retiré par un import
                if champ in verrous:
                    if getattr(e, champ) != v:
                        protegees += 1
                    continue
                if getattr(e, champ) != v:
                    setattr(e, champ, v)
                    change = True
            if "commercial_id" not in verrous and e.commercial_id is None:
                u = self._commercial(ligne.get("commercial"), "Base", n)
                if u:
                    e.commercial_id, e.date_attribution = u.id, today
                    change = True
            if e.absente_dernier_import:
                e.absente_dernier_import = False
                change = True
            maj += change
            inchangees += not change
        for eid, e in existantes.items():
            if eid not in vus and eid not in self.alias and e.statut == STATUT_ACTIVE and not e.absente_dernier_import:
                e.absente_dernier_import = True
                self.r.ajouter("absentes", eid)
                self.r.compteurs["absentes"] += 1
        self.r.data["resume"].update({"lignes_base": len(table.lignes), "entreprises_mises_a_jour": maj,
                                      "entreprises_inchangees": inchangees, "valeurs_protegees_non_ecrasees": protegees})
        self.db.flush()

    def _valeurs_base(self, ligne: dict, n: int, eid: str) -> dict:
        v: dict[str, Any] = {}
        for champ in CHAMPS_IDENTITE:
            if champ in ligne:
                v[champ] = convertir(champ, ligne[champ])
        if "statut_validation" in ligne:
            v["statut_validation"] = statut_validation(ligne["statut_validation"])
        v["raison_sociale"] = v.get("raison_sociale") or ""
        rccm, naema = v.get("rccm"), v.get("naema_code")
        if rccm and not est_rccm(rccm) and ressemble_naema(rccm):
            self.r.anomalie("rccm_naema", f"La valeur RCCM « {rccm} » ressemble à un code NAEMA : à vérifier (non déplacée)", "Base", n, eid)
        if naema and est_rccm(naema):
            self.r.anomalie("rccm_naema", f"La valeur NAEMA « {naema} » est un RCCM : à vérifier (non déplacée)", "Base", n, eid)
        if "nb_fiches" in ligne:
            v["nb_fiches"] = vers_int(ligne["nb_fiches"]) or 0
        if "score_classeur" in ligne:
            v["score_classeur"] = vers_float(ligne["score_classeur"])
        if "categorie_classeur" in ligne:
            c = (texte(ligne["categorie_classeur"]) or "").upper()[:1]
            v["categorie_classeur"] = c if c in "ABCD" and c else None
        if "vague_classeur" in ligne:
            v["vague_classeur"] = vers_int(ligne["vague_classeur"])
        if "vague_manuelle" in ligne:
            v["vague_manuelle"] = vers_int(ligne["vague_manuelle"])
        if "est_cliente" in ligne:
            v["est_cliente"] = bool(vers_bool(ligne["est_cliente"]))
        return v

    def _fiches(self, moteur) -> None:
        # Données techniques du moteur : remplacées intégralement à chaque import.
        self.db.query(ProvenanceChamp).delete()
        self.db.query(Fiche).delete()
        self.db.query(FichierPdf).delete()
        self.db.flush()
        self.db.bulk_insert_mappings(FichierPdf, moteur.fichiers)
        fichiers = {f["id"] for f in moteur.fichiers}
        ids_app = {eid for (eid,) in self.db.query(Entreprise.id)}
        sans_entite = inconnues = 0
        rows, par_entite = [], {}
        for f in moteur.fiches:
            eid = resoudre_alias(self.alias, (f["entreprise_id"] or "").upper() or None)
            if f["fichier_id"] is not None and f["fichier_id"] not in fichiers:
                self.r.anomalie("fichier_inconnu", f"Fiche {f['id']} : fichier {f['fichier_id']} absent de la table files", "radar.db")
            if not eid:
                sans_entite += 1
            elif eid not in ids_app:
                inconnues += 1
                if inconnues <= 50:
                    self.r.anomalie("entite_hors_base", f"Fiche {f['id']} rattachée à {eid}, absent de l'onglet Base", "radar.db", None, eid)
            rows.append({**f, "entreprise_id": eid})
            if eid:
                par_entite.setdefault(eid, []).append(f)
        self.db.bulk_insert_mappings(Fiche, rows)
        # Provenance champ par champ : fiche dont la valeur correspond, sinon première fiche rattachée.
        idx = C.index_alias(C.BASE)
        prov = []
        for e in self.db.query(Entreprise).filter(Entreprise.id.in_(list(par_entite))):
            fiches = sorted(par_entite[e.id], key=lambda x: x["id"])
            normalisees = [(f, {idx.get(cle_colonne(k)): normaliser(v) for k, v in f["donnees"].items()}) for f in fiches]
            for champ in CHAMPS_IDENTITE:
                valeur = getattr(e, champ)
                if valeur in (None, ""):
                    continue
                cible = normaliser(valeur)
                trouve = next((f for f, d in normalisees if d.get(champ) == cible), None)
                f = trouve or fiches[0]
                prov.append({"entreprise_id": e.id, "champ": champ, "fiche_id": f["id"], "fichier_id": f["fichier_id"],
                             "page": f["page"], "exacte": trouve is not None})
            if not e.nb_fiches:
                e.nb_fiches = len(fiches)
        self.db.bulk_insert_mappings(ProvenanceChamp, prov)
        if sans_entite:
            self.r.anomalie("fiche_sans_entite", f"{sans_entite} fiche(s) sans entité rattachée dans entity_map", "radar.db")
        if inconnues > 50:
            self.r.anomalie("entite_hors_base", f"… et {inconnues - 50} autres fiches rattachées à un ID absent de Base", "radar.db")
        self.r.data["resume"].update({"fichiers_pdf": len(moteur.fichiers), "fiches": len(moteur.fiches),
                                      "entreprises_avec_source": len(par_entite)})
        self.db.flush()

    def _appliquer_alias_existants(self) -> None:
        """Fusionne dans l'application les entreprises dont l'ID est devenu un alias."""
        for ancien, nouvel in self.alias.items():
            nouvel = resoudre_alias(self.alias, nouvel)
            e = self.db.get(Entreprise, ancien)
            if e is None or e.statut == STATUT_FUSIONNEE:
                continue
            cible = self.db.get(Entreprise, nouvel)
            if cible is None:
                self.r.anomalie("alias_cible_absente", f"Alias {ancien} → {nouvel} : {nouvel} absent de la base, fusion non appliquée", None, None, ancien)
                continue
            if cible.statut != STATUT_ACTIVE:
                self.r.anomalie("alias_cible_inactive", f"Alias {ancien} → {nouvel} : cible non active", None, None, ancien)
                continue
            deplaces = D.fusionner(self.db, nouvel, ancien, "Alias moteur (entity_alias)", origine="moteur")
            self.r.ajouter("ids_fusionnes", {"ancien_id": ancien, "nouvel_id": nouvel, **deplaces})
            self.r.compteurs["fusionnes"] += 1
        self.db.flush()

    def _corrections(self, classeur: Classeur) -> None:
        table = classeur.table("corrections", C.CORRECTIONS)
        if table.non_reconnues:
            self.r.data["colonnes_non_reconnues"]["Corrections"] = table.non_reconnues
        cles = {k for (k,) in self.db.query(Correction.import_key).filter(Correction.import_key.isnot(None))}
        a_appliquer = []
        for ligne in table.lignes:
            n = ligne["_ligne"]
            eid = self._id(ligne.get("entreprise_id"), "Corrections", n)
            if not eid:
                self.r.saisie("Corrections", "rejetees")
                continue
            champ = C.champ_canonique(str(ligne.get("champ") or ""))
            if champ is None:
                self.r.anomalie("champ_inconnu", f"Champ « {ligne.get('champ')} » non reconnu", "Corrections", n, eid)
                self.r.saisie("Corrections", "rejetees")
                continue
            d = vers_date(ligne.get("date"))
            cle = _cle("corr", ligne.get("entreprise_id"), champ, ligne.get("apres"), d)
            a_appliquer.append((d or date.min, n, eid, champ, ligne, cle, cle in cles))
        # Ordre chronologique : la correction la plus récente l'emporte.
        for d, n, eid, champ, ligne, cle, deja in sorted(a_appliquer, key=lambda x: (x[0], x[1])):
            e = self.db.get(Entreprise, eid)
            app = (self.db.query(Correction).filter(Correction.entreprise_id == eid, Correction.champ == champ,
                                                   Correction.origine == "application").first())
            if app is not None:
                self.r.saisie("Corrections", "ignorees_correction_application_plus_recente")
                continue
            if deja:
                # Correction déjà importée : on réapplique la valeur (l'import Base a pu la modifier).
                if convertir(champ, ligne.get("apres")) != getattr(e, champ):
                    setattr(e, champ, convertir(champ, ligne.get("apres")))
                if champ not in (e.champs_verrouilles or []):
                    e.champs_verrouilles = [*(e.champs_verrouilles or []), champ]
                self.r.saisie("Corrections", "deja_presentes")
                continue
            try:
                c = corriger(self.db, e, champ, ligne.get("apres"), texte(ligne.get("auteur")) or "classeur",
                             texte(ligne.get("motif")), origine="classeur",
                             date=datetime.combine(d, datetime.min.time()) if d != date.min else None, import_key=cle)
                if c is None:
                    self.db.add(Correction(entreprise_id=eid, champ=champ, avant=texte(ligne.get("avant")),
                                           apres=texte(ligne.get("apres")), auteur=texte(ligne.get("auteur")) or "classeur",
                                           motif=texte(ligne.get("motif")), origine="classeur", import_key=cle))
                self.r.saisie("Corrections", "importees")
            except CorrectionInvalide as exc:
                self.r.anomalie("correction_invalide", str(exc), "Corrections", n, eid)
                self.r.saisie("Corrections", "rejetees")
        self.db.flush()

    def _call_tracker(self, classeur: Classeur) -> None:
        table = classeur.table("call_tracker", C.CALL_TRACKER)
        if table.non_reconnues:
            self.r.data["colonnes_non_reconnues"]["Call Tracker"] = table.non_reconnues
        cles = {k for (k,) in self.db.query(Interaction.import_key).filter(Interaction.import_key.isnot(None))}
        types = {normaliser(t): t for t in TYPES_INTERACTION}
        types.update({"telephone": "Appel", "appel_telephonique": "Appel", "mail": "E-mail", "email": "E-mail",
                      "whatsapp": "WhatsApp/SMS", "sms": "WhatsApp/SMS", "rendez vous": "RDV", "reunion": "RDV"})
        for ligne in table.lignes:
            n = ligne["_ligne"]
            cle = _cle("ct", ligne.get("entreprise_id"), vers_date(ligne.get("date")), ligne.get("type"),
                       ligne.get("tentative"), ligne.get("commercial"), ligne.get("resultat"), ligne.get("commentaire"))
            if cle in cles:
                self.r.saisie("Call Tracker", "deja_presentes")
                continue
            eid = self._id(ligne.get("entreprise_id"), "Call Tracker", n)
            d = vers_date(ligne.get("date"))
            if not eid or not d:
                if eid and not d:
                    self.r.anomalie("date_invalide", f"Date illisible : {ligne.get('date')!r}", "Call Tracker", n, eid)
                self.r.saisie("Call Tracker", "rejetees")
                continue
            t = types.get(normaliser(ligne.get("type")), "Appel" if not ligne.get("type") else "Autre")
            u = self._commercial(ligne.get("commercial"), "Call Tracker", n)
            rdv = bool(vers_bool(ligne.get("rdv_obtenu")))
            self.db.add(Interaction(
                entreprise_id=eid, commercial_id=u.id if u else None, date=d, type=t,
                tentative=vers_int(ligne.get("tentative")) or 1, joint=bool(vers_bool(ligne.get("joint"))),
                decideur_joint=bool(vers_bool(ligne.get("decideur_joint"))), rdv_obtenu=rdv,
                date_rdv=vers_date(ligne.get("date_rdv")) or (vers_date(ligne.get("rdv_obtenu")) if not rdv else None),
                resultat=texte(ligne.get("resultat")), commentaire=texte(ligne.get("commentaire")),
                prochaine_action=texte(ligne.get("prochaine_action")),
                date_prochaine_action=vers_date(ligne.get("date_prochaine_action")),
                import_key=cle, cree_par="classeur"))
            cles.add(cle)
            self.r.saisie("Call Tracker", "importees")
        self.db.flush()

    def _qualification(self, classeur: Classeur) -> None:
        table = classeur.table("qualification", C.QUALIFICATION)
        if table.non_reconnues:
            self.r.data["colonnes_non_reconnues"]["Qualification FX"] = table.non_reconnues
        for ligne in table.lignes:
            n = ligne["_ligne"]
            eid = self._id(ligne.get("entreprise_id"), "Qualification FX", n)
            if not eid:
                self.r.saisie("Qualification FX", "rejetees")
                continue
            produits = [p for p in PRODUITS_FX if vers_bool(ligne.get(p.lower()))]
            if ligne.get("produits"):
                txt = normaliser(ligne["produits"])
                produits += [p for p in PRODUITS_FX if normaliser(p) in txt and p not in produits]
            devises = [d.strip().upper() for d in str(ligne.get("devises") or "").replace(";", ",").replace("/", ",").split(",") if d.strip()]
            valeurs = dict(
                devises=devises, volume_annuel_fcfa=vers_float(ligne.get("volume_annuel_fcfa")),
                frequence=self._libelle(ligne.get("frequence"), self.params["frequence_points"]),
                banque_actuelle=texte(ligne.get("banque_actuelle")), besoin_confirme=vers_bool(ligne.get("besoin_confirme")),
                produits=produits, import_confirme=vers_bool(ligne.get("import_confirme")),
                export_confirme=vers_bool(ligne.get("export_confirme")),
                potentiel=self._libelle(ligne.get("potentiel"), self.params["potentiel_points"]),
                date_qualification=vers_date(ligne.get("date_qualification")), commentaire=texte(ligne.get("commentaire")),
            )
            q_flag = vers_bool(ligne.get("qualifiee"))
            valeurs["qualifiee"] = q_flag if q_flag is not None else bool(valeurs["date_qualification"] or valeurs["besoin_confirme"] is not None)
            cle = _cle("q", *[valeurs[k] for k in sorted(valeurs)])
            q = self.db.get(Qualification, eid)
            if q is None:
                self.db.add(Qualification(entreprise_id=eid, import_key=cle, modifie_par="classeur", **valeurs))
                self.r.saisie("Qualification FX", "importees")
            elif q.import_key == cle:
                self.r.saisie("Qualification FX", "deja_presentes")
            else:
                # Une qualification existe déjà dans l'application : jamais écrasée.
                self.r.saisie("Qualification FX", "conservees_application")
        self.db.flush()

    @staticmethod
    def _libelle(valeur: Any, referentiel: dict) -> str | None:
        if valeur in (None, ""):
            return None
        idx = {normaliser(k): k for k in referentiel}
        return idx.get(normaliser(valeur), texte(valeur))

    def _etape(self, valeur: Any) -> str | None:
        if valeur in (None, ""):
            return None
        etapes = [e["nom"] for e in self.params["etapes_pipeline"]]
        def coeur(s: str) -> str:
            return normaliser(s).lstrip("0123456789. ").strip()
        idx = {coeur(e): e for e in etapes}
        idx.update({normaliser(e): e for e in etapes})
        return idx.get(normaliser(valeur)) or idx.get(coeur(str(valeur)))

    def _pipeline(self, classeur: Classeur) -> None:
        table = classeur.table("pipeline", C.PIPELINE)
        if table.non_reconnues:
            self.r.data["colonnes_non_reconnues"]["Pipeline"] = table.non_reconnues
        cles = {k for (k,) in self.db.query(Opportunite.import_key).filter(Opportunite.import_key.isnot(None))}
        for ligne in table.lignes:
            n = ligne["_ligne"]
            cle = _cle("p", ligne.get("entreprise_id"), ligne.get("intitule"), ligne.get("produit"), ligne.get("montant"),
                       ligne.get("devise"), vers_date(ligne.get("date_ouverture")))
            if cle in cles:
                self.r.saisie("Pipeline", "deja_presentes")
                continue
            eid = self._id(ligne.get("entreprise_id"), "Pipeline", n)
            if not eid:
                self.r.saisie("Pipeline", "rejetees")
                continue
            etape = self._etape(ligne.get("etape"))
            if etape is None:
                self.r.anomalie("etape_inconnue", f"Étape « {ligne.get('etape')} » absente du paramétrage : rangée en « {self.params['etapes_pipeline'][0]['nom']} »", "Pipeline", n, eid)
                etape = self.params["etapes_pipeline"][0]["nom"]
            proba = vers_float(ligne.get("probabilite"))
            if proba is not None and proba <= 1:
                proba *= 100
            u = self._commercial(ligne.get("commercial"), "Pipeline", n)
            self.db.add(Opportunite(
                entreprise_id=eid, commercial_id=u.id if u else None, intitule=texte(ligne.get("intitule")),
                produit=texte(ligne.get("produit")), etape=etape, montant=vers_float(ligne.get("montant")),
                devise=(texte(ligne.get("devise")) or "XOF").upper().replace("FCFA", "XOF")[:3],
                marge_pb=vers_float(ligne.get("marge_pb")), probabilite=int(proba) if proba is not None else None,
                date_ouverture=vers_date(ligne.get("date_ouverture")), date_cloture_prevue=vers_date(ligne.get("date_cloture_prevue")),
                commentaire=texte(ligne.get("commentaire")), import_key=cle, cree_par="classeur"))
            cles.add(cle)
            if etape == P.etape_gagnee(self.params):
                self.db.get(Entreprise, eid).est_cliente = True
            self.r.saisie("Pipeline", "importees")
        self.db.flush()

    def _doublons(self, classeur: Classeur) -> None:
        table = classeur.table("doublons", C.DOUBLONS)
        if table.non_reconnues:
            self.r.data["colonnes_non_reconnues"]["Doublons"] = table.non_reconnues
        for ligne in table.lignes:
            n = ligne["_ligne"]
            a = self._id(ligne.get("id_a"), "Doublons", n)
            b = self._id(ligne.get("id_b"), "Doublons", n)
            if not a or not b or a == b:
                self.r.saisie("Doublons", "sans_objet_ou_rejetees")
                continue
            a, b = sorted((a, b))
            dec = normaliser(ligne.get("decision"))
            decision = DECISION_DOUBLON if "doublon" in dec and "confirm" in dec else (
                DECISION_DISTINCTES if "distinct" in dec else None)
            p = self.db.query(PaireDoublon).filter_by(id_a=a, id_b=b).first()
            crit = [c.strip() for c in str(ligne.get("criteres") or "").split(",") if c.strip()] or ["Classeur"]
            if p is None:
                p = PaireDoublon(id_a=a, id_b=b, criteres=crit, niveau=D._niveau(set(crit)) if set(crit) & (D.CRITERES_FORTS | D.CRITERES_MOYENS) else "moyen", origine="classeur")
                self.db.add(p)
                self.db.flush()
                self.r.saisie("Doublons", "paires_importees")
            if p.decision is not None or decision is None:
                self.r.saisie("Doublons", "deja_decidees" if p.decision else "sans_decision")
                continue
            try:
                D.decider(self.db, p, decision, auteur="classeur", id_principal=self._id(ligne.get("id_principal"), "Doublons", n) if ligne.get("id_principal") else None,
                          justification=texte(ligne.get("justification")) or "Décision reprise du classeur (onglet Doublons)")
                self.r.saisie("Doublons", "decisions_importees")
            except D.DecisionInvalide as exc:
                self.r.anomalie("doublon", str(exc), "Doublons", n, a)
        self.db.flush()

    def _divergences(self) -> None:
        """Compare score / catégorie / vague recalculés avec les valeurs du classeur."""
        div = {"score": 0, "categorie": 0, "vague": 0, "exemples": []}
        for e in self.db.query(Entreprise).filter(Entreprise.statut == STATUT_ACTIVE):
            ecarts = []
            if e.score_classeur is not None and abs(e.score - e.score_classeur) > 0.5:
                div["score"] += 1; ecarts.append(f"score {e.score_classeur:g} → {e.score}")
            if e.categorie_classeur and e.categorie_classeur != e.categorie:
                div["categorie"] += 1; ecarts.append(f"catégorie {e.categorie_classeur} → {e.categorie}")
            if e.vague_classeur and e.vague_classeur != e.vague:
                div["vague"] += 1; ecarts.append(f"vague {e.vague_classeur} → {e.vague}")
            if ecarts and len(div["exemples"]) < 50:
                div["exemples"].append({"id": e.id, "ecarts": ecarts})
        self.r.data["divergences_classeur"] = div

    def _resume(self) -> None:
        res = self.r.data["resume"]
        res["nouvelles_entreprises"] = self.r.compteurs["nouvelles"]
        res["ids_fusionnes"] = self.r.compteurs["fusionnes"]
        res["entreprises_absentes_du_classeur"] = self.r.compteurs["absentes"]
        res["saisies_realignees_par_alias"] = self.r.compteurs["saisies_realignees"]
        res["total_entreprises"] = self.db.query(Entreprise).count()
        res["entreprises_actives"] = self.db.query(Entreprise).filter(Entreprise.statut == STATUT_ACTIVE).count()
        res["jeu_fictif"] = self.fictif


def importer(db: Session, utilisateur: str, classeur: str | Path | None = None, radar_db: str | Path | None = None,
             simulation: bool = False) -> dict:
    try:
        return Importeur(db, utilisateur, classeur, radar_db).executer(simulation=simulation)
    except Exception:
        db.rollback()
        raise
