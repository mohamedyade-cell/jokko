"""Correspondance entre les en-têtes du classeur et les champs de l'application.

Les en-têtes sont comparés après normalisation (minuscules, sans accents,
caractères non alphanumériques remplacés par « _ »). Si le classeur utilise un
libellé absent de ces listes, la colonne est signalée dans le rapport d'import
(« colonnes non reconnues ») : il suffit alors d'ajouter l'alias ici.
"""
from __future__ import annotations

from ..utils import cle_colonne

ONGLETS = {
    "base": ["base", "base_entreprises", "base_validee"],
    "call_tracker": ["call_tracker", "calltracker", "suivi_appels", "call_tracking"],
    "qualification": ["qualification_fx", "qualification", "qualif_fx"],
    "pipeline": ["pipeline", "pipe"],
    "corrections": ["corrections", "correction"],
    "doublons": ["doublons", "doublon"],
    "parametres": ["parametres", "parametre", "parametrage", "settings"],
    "scoring": ["scoring", "score", "bareme"],
}

ID = ["id", "id_entreprise", "identifiant", "entity_id", "id_unique", "code_entreprise", "id_ent", "ent_id"]

BASE = {
    "id": ID,
    "raison_sociale": ["raison_sociale", "nom", "denomination", "entreprise", "nom_entreprise", "societe", "raison_social"],
    "sigle": ["sigle", "enseigne", "acronyme", "nom_commercial"],
    "ninea": ["ninea", "numero_ninea", "ninea_ninet", "n_ninea", "no_ninea"],
    "rccm": ["rccm", "registre_de_commerce", "numero_rccm", "n_rccm", "no_rccm", "rc"],
    "naema_code": ["naema", "code_naema", "naf", "code_naf", "naema_naf", "code_activite", "naema_code"],
    "naema_libelle": ["libelle_naema", "libelle_naf", "naema_libelle", "libelle_activite_naema"],
    "activite": ["activite", "activites", "objet_social", "secteur_activite", "description", "activite_principale"],
    "forme_juridique": ["forme_juridique", "forme"],
    "adresse": ["adresse", "adresse_postale", "siege", "siege_social"],
    "ville": ["ville", "localite", "commune"],
    "region": ["region"],
    "telephone": ["telephone", "tel", "telephone_1", "tel_1", "phone", "telephones"],
    "telephone2": ["telephone_2", "tel_2", "mobile", "portable", "cellulaire"],
    "email": ["email", "e_mail", "courriel", "mail", "adresse_email"],
    "site_web": ["site_web", "site", "web", "site_internet"],
    "contact_nom": ["dirigeant", "contact", "nom_contact", "gerant", "pdg", "dg", "contact_principal", "nom_dirigeant"],
    "contact_fonction": ["fonction", "fonction_contact", "titre", "fonction_dirigeant"],
    "segment": ["segment", "segment_fx", "secteur_fx"],
    "taille": ["taille", "taille_entreprise", "categorie_taille"],
    "effectif": ["effectif", "effectifs", "nb_employes", "employes", "nombre_employes"],
    "chiffre_affaires": ["chiffre_d_affaires", "chiffre_affaires", "ca", "ca_fcfa", "chiffre_d_affaires_fcfa"],
    "capital": ["capital", "capital_social"],
    "import_hyp": ["import", "importateur", "import_oui_non", "activite_import", "importe"],
    "export_hyp": ["export", "exportateur", "export_oui_non", "activite_export", "exporte"],
    "commercial": ["commercial", "fx_sales", "attribue_a", "charge_d_affaires", "sales", "responsable_commercial", "commercial_attribue"],
    "vague_manuelle": ["vague_manuelle", "vague_forcee", "vague_forcee_manuelle", "forcer_vague"],
    "statut_validation": ["statut_validation", "validation", "base_validee", "validee", "valide", "statut_fiche"],
    "nb_fiches": ["nb_fiches", "nombre_de_fiches", "fiches", "nb_sources"],
    "score_classeur": ["score", "score_total", "score_100", "score_fx"],
    "categorie_classeur": ["categorie", "cat", "categorie_abcd", "categorie_score"],
    "vague_classeur": ["vague", "vague_calculee", "vague_finale"],
    "est_cliente": ["cliente", "client", "deja_client", "client_sunu"],
}

CALL_TRACKER = {
    "entreprise_id": ID,
    "date": ["date", "date_interaction", "date_appel", "date_contact"],
    "type": ["type", "type_interaction", "canal", "type_contact"],
    "tentative": ["tentative", "n_tentative", "numero_tentative", "tentative_n", "no_tentative"],
    "joint": ["joint", "contact_joint", "joignable"],
    "decideur_joint": ["decideur", "decideur_joint"],
    "rdv_obtenu": ["rdv", "rdv_obtenu", "rdv_fixe"],
    "date_rdv": ["date_rdv", "date_du_rdv"],
    "resultat": ["resultat", "issue", "resultat_appel"],
    "commentaire": ["commentaire", "commentaires", "notes", "remarque", "remarques"],
    "prochaine_action": ["prochaine_action", "action_suivante", "next_step", "action"],
    "date_prochaine_action": ["date_prochaine_action", "date_relance", "relance", "date_action", "echeance"],
    "commercial": ["commercial", "fx_sales", "auteur", "sales", "par"],
}

QUALIFICATION = {
    "entreprise_id": ID,
    "devises": ["devises", "devise", "devises_traitees", "devises_utilisees"],
    "volume_annuel_fcfa": ["volume", "volume_annuel", "volume_annuel_fcfa", "volumes", "volume_fx", "volume_fx_annuel"],
    "frequence": ["frequence", "frequence_operations", "frequence_des_operations"],
    "banque_actuelle": ["banque", "banque_actuelle", "banque_principale", "banques_actuelles"],
    "besoin_confirme": ["besoin_confirme", "besoin_couverture", "besoin", "besoin_de_couverture"],
    "produits": ["produits", "produits_cibles", "produits_fx"],
    "spot": ["spot"],
    "forward": ["forward", "terme"],
    "flexiterme": ["flexiterme", "flexi_terme"],
    "transferts": ["transferts", "transfert", "transferts_internationaux"],
    "import_confirme": ["import_confirme", "import"],
    "export_confirme": ["export_confirme", "export"],
    "potentiel": ["potentiel", "potentiel_confirme"],
    "qualifiee": ["qualifiee", "statut_qualification", "qualifie"],
    "date_qualification": ["date", "date_qualification"],
    "commentaire": ["commentaire", "commentaires", "notes"],
}

PIPELINE = {
    "entreprise_id": ID,
    "intitule": ["intitule", "opportunite", "libelle", "nom_opportunite"],
    "produit": ["produit"],
    "etape": ["etape", "stade", "statut", "etape_pipeline"],
    "montant": ["montant", "montant_estime", "volume", "nominal"],
    "devise": ["devise", "monnaie"],
    "marge_pb": ["marge", "marge_pb", "marge_bp", "marge_points_de_base", "marge_en_pb"],
    "probabilite": ["probabilite", "proba", "probabilite_pct"],
    "date_ouverture": ["date_ouverture", "ouverture", "date_creation", "date_d_ouverture"],
    "date_cloture_prevue": ["date_cloture", "date_cloture_prevue", "cloture", "date_de_cloture", "cloture_prevue"],
    "commercial": ["commercial", "fx_sales", "sales"],
    "commentaire": ["commentaire", "commentaires", "notes"],
}

CORRECTIONS = {
    "entreprise_id": ID,
    "champ": ["champ", "colonne", "champ_corrige", "donnee"],
    "avant": ["avant", "ancienne_valeur", "valeur_avant", "valeur_initiale"],
    "apres": ["apres", "nouvelle_valeur", "valeur_apres", "valeur_corrigee", "correction"],
    "auteur": ["auteur", "par", "utilisateur", "corrige_par"],
    "date": ["date", "date_correction"],
    "motif": ["motif", "commentaire", "raison", "justification"],
}

DOUBLONS = {
    "id_a": ["id_1", "id1", "id_a", "entreprise_1", "id_entreprise_1", "id_principal_candidat"],
    "id_b": ["id_2", "id2", "id_b", "entreprise_2", "id_entreprise_2", "id_doublon"],
    "decision": ["decision", "statut", "verdict"],
    "criteres": ["critere", "criteres", "motif_detection", "regle"],
    "justification": ["commentaire", "justification", "commentaires"],
    "id_principal": ["id_principal", "id_conserve", "id_retenu"],
}

SEGMENTS = {
    "nom": ["segment", "nom", "segments"],
    "import_pts": ["import", "points_import", "import_pts"],
    "export_pts": ["export", "points_export", "export_pts"],
    "intensite_pts": ["intensite", "points_intensite", "intensite_pts"],
    "frequence_pts": ["frequence", "points_frequence", "frequence_pts"],
    "couverture_pts": ["couverture", "points_couverture", "couverture_pts"],
    "potentiel_pts": ["potentiel", "points_potentiel", "potentiel_pts"],
    "vague_defaut": ["vague", "vague_defaut", "vague_par_defaut"],
    "accroche": ["accroche", "accroche_commerciale", "pitch", "argumentaire"],
}

TAILLES = {
    "nom": ["taille", "nom", "tailles"],
    "ordre": ["ordre", "rang"],
    "intensite_pts": ["intensite", "points_intensite", "intensite_pts"],
    "frequence_pts": ["frequence", "points_frequence", "frequence_pts"],
    "potentiel_pts": ["potentiel", "points_potentiel", "potentiel_pts"],
}

PARAMETRES = {
    "seuil_A": ["seuil_a", "seuil_categorie_a", "categorie_a", "seuil_cat_a"],
    "seuil_B": ["seuil_b", "seuil_categorie_b", "categorie_b", "seuil_cat_b"],
    "seuil_C": ["seuil_c", "seuil_categorie_c", "categorie_c", "seuil_cat_c"],
    "objectif_couverture_pct": ["objectif_couverture", "objectif_couverture_pct", "objectif_couverture_6_mois", "couverture_cible"],
    "objectif_duree_mois": ["duree_objectif", "objectif_duree_mois", "duree_objectif_mois"],
    "date_lancement": ["date_lancement", "date_de_lancement", "debut_campagne"],
    "vagues_lancees": ["vagues_lancees", "vague_lancee", "vagues_actives"],
    "marge_pb_defaut": ["marge_pb", "marge_par_defaut", "marge_par_defaut_pb", "marge_defaut_pb"],
    "vague_grande_taille_active": ["grande_taille_vague_1", "vague_grande_taille", "option_grande_taille"],
    "jeu_de_donnees": ["jeu_de_donnees", "type_de_donnees", "donnees"],
}

CHAMPS_CORRIGEABLES_ALIAS = {k: v for k, v in BASE.items() if k not in {"id", "nb_fiches", "score_classeur", "categorie_classeur", "vague_classeur", "commercial"}}


def index_alias(mapping: dict[str, list[str]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for champ, aliases in mapping.items():
        for a in [champ, *aliases]:
            out.setdefault(cle_colonne(a), champ)
    return out


def champ_canonique(nom: str, mapping: dict[str, list[str]] = CHAMPS_CORRIGEABLES_ALIAS) -> str | None:
    return index_alias(mapping).get(cle_colonne(nom))
