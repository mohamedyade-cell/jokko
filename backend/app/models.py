"""Modèle de données de SUNU FX SALES RADAR.

Principes :
- l'identifiant d'une entreprise est celui du moteur Python (ENT-00001) ; l'application
  n'en génère jamais ;
- une entreprise n'est jamais supprimée : une fusion la marque « Fusionnée » et
  enregistre un alias ancien ID → nouvel ID ;
- les champs saisis ou corrigés dans l'application sont « verrouillés » et ne sont
  jamais écrasés par un import ;
- les champs dérivés (score, catégorie, vague) sont stockés pour des listes rapides
  et recalculés à chaque modification.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

ROLE_FX_SALES = "fx_sales"
ROLE_RESPONSABLE = "responsable"
ROLE_LECTURE = "lecture"
ROLES = (ROLE_FX_SALES, ROLE_RESPONSABLE, ROLE_LECTURE)

STATUT_ACTIVE = "Active"
STATUT_FUSIONNEE = "Fusionnée"

VALIDATION_VALIDEE = "Validée"
VALIDATION_A_VERIFIER = "À vérifier"

TYPES_INTERACTION = ("Appel", "E-mail", "RDV", "Visite", "WhatsApp/SMS", "Autre")
PRODUITS_FX = ("Spot", "Forward", "Flexiterme", "Transferts")

DECISION_DOUBLON = "Doublon confirmé"
DECISION_DISTINCTES = "Entreprises distinctes"


class Utilisateur(Base):
    __tablename__ = "utilisateurs"

    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    nom: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True)
    role: Mapped[str] = mapped_column(String(20))
    mot_de_passe_hash: Mapped[str | None] = mapped_column(String(300), nullable=True)
    entra_oid: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    alias_classeur: Mapped[str | None] = mapped_column(String(200), nullable=True)  # nom utilisé dans le classeur
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Entreprise(Base):
    __tablename__ = "entreprises"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)  # ENT-00001
    raison_sociale: Mapped[str] = mapped_column(String(300), default="")
    sigle: Mapped[str | None] = mapped_column(String(120), nullable=True)
    ninea: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    rccm: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)
    naema_code: Mapped[str | None] = mapped_column(String(20), nullable=True)  # code d'activité (NAEMA / NAF)
    naema_libelle: Mapped[str | None] = mapped_column(String(300), nullable=True)
    activite: Mapped[str | None] = mapped_column(Text, nullable=True)
    forme_juridique: Mapped[str | None] = mapped_column(String(80), nullable=True)
    adresse: Mapped[str | None] = mapped_column(String(300), nullable=True)
    ville: Mapped[str | None] = mapped_column(String(120), nullable=True)
    region: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    telephone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    telephone2: Mapped[str | None] = mapped_column(String(80), nullable=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    site_web: Mapped[str | None] = mapped_column(String(200), nullable=True)
    contact_nom: Mapped[str | None] = mapped_column(String(200), nullable=True)
    contact_fonction: Mapped[str | None] = mapped_column(String(200), nullable=True)
    segment: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    taille: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    effectif: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chiffre_affaires: Mapped[float | None] = mapped_column(Float, nullable=True)
    capital: Mapped[float | None] = mapped_column(Float, nullable=True)
    import_hyp: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # hypothèse issue de la base
    export_hyp: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    statut_validation: Mapped[str] = mapped_column(String(20), default=VALIDATION_A_VERIFIER, index=True)
    commercial_id: Mapped[int | None] = mapped_column(ForeignKey("utilisateurs.id"), nullable=True, index=True)
    date_attribution: Mapped[date | None] = mapped_column(Date, nullable=True)
    vague_manuelle: Mapped[int | None] = mapped_column(Integer, nullable=True)
    est_cliente: Mapped[bool] = mapped_column(Boolean, default=False)
    nb_fiches: Mapped[int] = mapped_column(Integer, default=0)

    # Champs dérivés, recalculés (non audités)
    score: Mapped[int] = mapped_column(Integer, default=0, index=True)
    score_detail: Mapped[dict] = mapped_column(JSON, default=dict)
    categorie: Mapped[str] = mapped_column(String(1), default="D", index=True)
    vague: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    vague_regle: Mapped[str | None] = mapped_column(String(120), nullable=True)
    recherche: Mapped[str] = mapped_column(Text, default="")  # texte normalisé pour la recherche

    # Valeurs calculées par le classeur, conservées pour contrôle de cohérence
    score_classeur: Mapped[float | None] = mapped_column(Float, nullable=True)
    categorie_classeur: Mapped[str | None] = mapped_column(String(1), nullable=True)
    vague_classeur: Mapped[int | None] = mapped_column(Integer, nullable=True)

    statut: Mapped[str] = mapped_column(String(20), default=STATUT_ACTIVE, index=True)
    fusionnee_vers: Mapped[str | None] = mapped_column(String(20), nullable=True)
    fictif: Mapped[bool] = mapped_column(Boolean, default=False)
    champs_verrouilles: Mapped[list] = mapped_column(JSON, default=list)
    absente_dernier_import: Mapped[bool] = mapped_column(Boolean, default=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    modifie_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    commercial: Mapped[Utilisateur | None] = relationship(lazy="joined")


class FichierPdf(Base):
    __tablename__ = "fichiers_pdf"

    id: Mapped[int] = mapped_column(primary_key=True)  # identifiant du moteur (table files)
    nom: Mapped[str] = mapped_column(String(300))
    chemin: Mapped[str | None] = mapped_column(String(500), nullable=True)
    nb_pages: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Fiche(Base):
    """Une fiche extraite d'un PDF CCI (table `sources` du moteur)."""

    __tablename__ = "fiches"

    id: Mapped[int] = mapped_column(primary_key=True)
    entreprise_id: Mapped[str | None] = mapped_column(String(20), index=True, nullable=True)
    fichier_id: Mapped[int | None] = mapped_column(ForeignKey("fichiers_pdf.id"), nullable=True)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    donnees: Mapped[dict] = mapped_column(JSON, default=dict)


class ProvenanceChamp(Base):
    __tablename__ = "provenances"
    __table_args__ = (UniqueConstraint("entreprise_id", "champ"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    entreprise_id: Mapped[str] = mapped_column(String(20), index=True)
    champ: Mapped[str] = mapped_column(String(60))
    fiche_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fichier_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exacte: Mapped[bool] = mapped_column(Boolean, default=True)  # False : fiche de rattachement, valeur non retrouvée


class EntiteAlias(Base):
    __tablename__ = "entite_alias"

    ancien_id: Mapped[str] = mapped_column(String(20), primary_key=True)
    nouvel_id: Mapped[str] = mapped_column(String(20), index=True)
    origine: Mapped[str] = mapped_column(String(20), default="moteur")  # moteur | doublon
    motif: Mapped[str | None] = mapped_column(Text, nullable=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Interaction(Base):
    __tablename__ = "interactions"
    __table_args__ = (Index("ix_interactions_relance", "date_prochaine_action", "action_faite"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    entreprise_id: Mapped[str] = mapped_column(ForeignKey("entreprises.id"), index=True)
    commercial_id: Mapped[int | None] = mapped_column(ForeignKey("utilisateurs.id"), nullable=True, index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    type: Mapped[str] = mapped_column(String(20))
    tentative: Mapped[int] = mapped_column(Integer, default=1)
    joint: Mapped[bool] = mapped_column(Boolean, default=False)
    decideur_joint: Mapped[bool] = mapped_column(Boolean, default=False)
    rdv_obtenu: Mapped[bool] = mapped_column(Boolean, default=False)
    date_rdv: Mapped[date | None] = mapped_column(Date, nullable=True)
    resultat: Mapped[str | None] = mapped_column(String(200), nullable=True)
    commentaire: Mapped[str | None] = mapped_column(Text, nullable=True)
    prochaine_action: Mapped[str | None] = mapped_column(String(200), nullable=True)
    date_prochaine_action: Mapped[date | None] = mapped_column(Date, nullable=True)
    action_faite: Mapped[bool] = mapped_column(Boolean, default=False)
    import_key: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    cree_par: Mapped[str | None] = mapped_column(String(120), nullable=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    commercial: Mapped[Utilisateur | None] = relationship(lazy="joined")


class Qualification(Base):
    __tablename__ = "qualifications"

    entreprise_id: Mapped[str] = mapped_column(ForeignKey("entreprises.id"), primary_key=True)
    devises: Mapped[list] = mapped_column(JSON, default=list)
    volume_annuel_fcfa: Mapped[float | None] = mapped_column(Float, nullable=True)
    frequence: Mapped[str | None] = mapped_column(String(40), nullable=True)
    banque_actuelle: Mapped[str | None] = mapped_column(String(200), nullable=True)
    besoin_confirme: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    produits: Mapped[list] = mapped_column(JSON, default=list)
    import_confirme: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    export_confirme: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    potentiel: Mapped[str | None] = mapped_column(String(20), nullable=True)  # Élevé | Moyen | Faible
    qualifiee: Mapped[bool] = mapped_column(Boolean, default=False)
    date_qualification: Mapped[date | None] = mapped_column(Date, nullable=True)
    commentaire: Mapped[str | None] = mapped_column(Text, nullable=True)
    import_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    modifie_par: Mapped[str | None] = mapped_column(String(120), nullable=True)
    modifie_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Opportunite(Base):
    __tablename__ = "opportunites"

    id: Mapped[int] = mapped_column(primary_key=True)
    entreprise_id: Mapped[str] = mapped_column(ForeignKey("entreprises.id"), index=True)
    commercial_id: Mapped[int | None] = mapped_column(ForeignKey("utilisateurs.id"), nullable=True, index=True)
    intitule: Mapped[str | None] = mapped_column(String(200), nullable=True)
    produit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    etape: Mapped[str] = mapped_column(String(60), index=True)
    montant: Mapped[float | None] = mapped_column(Float, nullable=True)
    devise: Mapped[str] = mapped_column(String(3), default="XOF")
    marge_pb: Mapped[float | None] = mapped_column(Float, nullable=True)
    probabilite: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_ouverture: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_cloture_prevue: Mapped[date | None] = mapped_column(Date, nullable=True)
    date_cloture: Mapped[date | None] = mapped_column(Date, nullable=True)
    commentaire: Mapped[str | None] = mapped_column(Text, nullable=True)
    import_key: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    cree_par: Mapped[str | None] = mapped_column(String(120), nullable=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    commercial: Mapped[Utilisateur | None] = relationship(lazy="joined")


class Correction(Base):
    __tablename__ = "corrections"

    id: Mapped[int] = mapped_column(primary_key=True)
    entreprise_id: Mapped[str] = mapped_column(String(20), index=True)
    champ: Mapped[str] = mapped_column(String(60))
    avant: Mapped[str | None] = mapped_column(Text, nullable=True)
    apres: Mapped[str | None] = mapped_column(Text, nullable=True)
    auteur: Mapped[str] = mapped_column(String(120))
    date: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    motif: Mapped[str | None] = mapped_column(Text, nullable=True)
    origine: Mapped[str] = mapped_column(String(20), default="application")  # application | classeur
    import_key: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)


class PaireDoublon(Base):
    __tablename__ = "doublons"
    __table_args__ = (UniqueConstraint("id_a", "id_b"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    id_a: Mapped[str] = mapped_column(String(20), index=True)
    id_b: Mapped[str] = mapped_column(String(20), index=True)
    criteres: Mapped[list] = mapped_column(JSON, default=list)
    niveau: Mapped[str] = mapped_column(String(10), default="faible")  # fort | moyen | faible
    decision: Mapped[str | None] = mapped_column(String(40), nullable=True)
    id_principal: Mapped[str | None] = mapped_column(String(20), nullable=True)
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    decide_par: Mapped[str | None] = mapped_column(String(120), nullable=True)
    decide_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    origine: Mapped[str] = mapped_column(String(20), default="detection")


class Segment(Base):
    __tablename__ = "segments"

    nom: Mapped[str] = mapped_column(String(120), primary_key=True)
    import_pts: Mapped[float] = mapped_column(Float, default=0)
    export_pts: Mapped[float] = mapped_column(Float, default=0)
    intensite_pts: Mapped[float] = mapped_column(Float, default=0)
    frequence_pts: Mapped[float] = mapped_column(Float, default=0)
    couverture_pts: Mapped[float] = mapped_column(Float, default=0)
    potentiel_pts: Mapped[float] = mapped_column(Float, default=0)
    vague_defaut: Mapped[int | None] = mapped_column(Integer, nullable=True)
    accroche: Mapped[str | None] = mapped_column(Text, nullable=True)


class Taille(Base):
    __tablename__ = "tailles"

    nom: Mapped[str] = mapped_column(String(40), primary_key=True)
    ordre: Mapped[int] = mapped_column(Integer, default=0)
    intensite_pts: Mapped[float] = mapped_column(Float, default=0)
    frequence_pts: Mapped[float] = mapped_column(Float, default=0)
    potentiel_pts: Mapped[float] = mapped_column(Float, default=0)


class Parametre(Base):
    __tablename__ = "parametres"

    cle: Mapped[str] = mapped_column(String(80), primary_key=True)
    valeur: Mapped[object] = mapped_column(JSON)


class Objectif(Base):
    __tablename__ = "objectifs"

    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), primary_key=True)
    portefeuille: Mapped[int | None] = mapped_column(Integer, nullable=True)
    contacts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rdv: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opportunites: Mapped[int | None] = mapped_column(Integer, nullable=True)
    clients: Mapped[int | None] = mapped_column(Integer, nullable=True)
    volume_fcfa: Mapped[float | None] = mapped_column(Float, nullable=True)


class JournalAudit(Base):
    __tablename__ = "journal_audit"

    id: Mapped[int] = mapped_column(primary_key=True)
    horodatage: Mapped[datetime] = mapped_column(DateTime, index=True)
    utilisateur: Mapped[str] = mapped_column(String(120), index=True)
    action: Mapped[str] = mapped_column(String(20))  # CREATION | MODIFICATION | SUPPRESSION
    table_cible: Mapped[str] = mapped_column(String(60), index=True)
    enregistrement_id: Mapped[str] = mapped_column(String(80), index=True)
    ancienne_valeur: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    nouvelle_valeur: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class ExecutionImport(Base):
    __tablename__ = "imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    debut: Mapped[datetime] = mapped_column(DateTime)
    fin: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    utilisateur: Mapped[str] = mapped_column(String(120))
    fichier_excel: Mapped[str | None] = mapped_column(String(500), nullable=True)
    fichier_db: Mapped[str | None] = mapped_column(String(500), nullable=True)
    empreinte: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statut: Mapped[str] = mapped_column(String(20), default="en cours")
    rapport: Mapped[dict] = mapped_column(JSON, default=dict)
