import { FormEvent, useState } from "react";
import { api, ErreurApi, TYPES_INTERACTION } from "../api";
import { aujourdhuiIso, plusJours } from "../format";
import { ChampDate, Erreur, Interrupteur, useToast } from "./ui";

const RESULTATS = ["Pas de réponse", "Mauvais numéro", "Rappeler", "Intéressé", "Pas intéressé", "RDV fixé", "Déjà client", "Envoi documentation", "Autre"];
const ACTIONS = ["Rappeler", "Envoyer documentation", "Relancer par e-mail", "Préparer RDV", "Envoyer offre", "Qualifier le besoin"];

export default function FormInteraction({ entrepriseId, tentativeSuivante = 1, onEnregistre }: { entrepriseId: string; tentativeSuivante?: number; onEnregistre: () => void }) {
  const notifier = useToast();
  const [f, setF] = useState({
    date: aujourdhuiIso(), type: "Appel", tentative: tentativeSuivante, joint: false, decideur_joint: false, rdv_obtenu: false,
    date_rdv: null as string | null, resultat: "", commentaire: "", prochaine_action: "Rappeler", date_prochaine_action: plusJours(aujourdhuiIso(), 2) as string | null,
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const envoyer = (e: FormEvent) => {
    e.preventDefault();
    setEnvoi(true);
    api.post("/api/interactions", { ...f, entreprise_id: entrepriseId, resultat: f.resultat || null, commentaire: f.commentaire || null,
      prochaine_action: f.prochaine_action || null, date_prochaine_action: f.prochaine_action ? f.date_prochaine_action : null })
      .then(() => { notifier("Interaction enregistrée"); onEnregistre(); })
      .catch((x: ErreurApi) => setErreur(x.message))
      .finally(() => setEnvoi(false));
  };

  return (
    <form onSubmit={envoyer} className="space-y-3">
      <Erreur texte={erreur} />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {TYPES_INTERACTION.map((t) => (
          <button type="button" key={t} onClick={() => set("type", t)}
            className={`min-h-[44px] rounded-lg border-2 text-sm font-medium ${f.type === t ? "border-sunu bg-sunu-clair text-sunu" : "border-gray-200"}`}>{t}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="etiquette">Date</label><ChampDate valeur={f.date} onChange={(v) => set("date", v ?? aujourdhuiIso())} requis /></div>
        <div><label className="etiquette" htmlFor="tent">Tentative n°</label><input id="tent" type="number" min={1} className="champ" value={f.tentative} onChange={(e) => set("tentative", Number(e.target.value) || 1)} /></div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Interrupteur libelle="Joint" valeur={f.joint} onChange={(v) => setF((x) => ({ ...x, joint: v, decideur_joint: v ? x.decideur_joint : false }))} />
        <Interrupteur libelle="Décideur" valeur={f.decideur_joint} onChange={(v) => setF((x) => ({ ...x, decideur_joint: v, joint: v || x.joint }))} />
        <Interrupteur libelle="RDV obtenu" valeur={f.rdv_obtenu} onChange={(v) => setF((x) => ({ ...x, rdv_obtenu: v, joint: v || x.joint }))} />
      </div>
      {f.rdv_obtenu && (
        <div><label className="etiquette">Date du RDV</label><ChampDate valeur={f.date_rdv} onChange={(v) => set("date_rdv", v)} requis /></div>
      )}
      <div>
        <label className="etiquette" htmlFor="res">Résultat</label>
        <select id="res" className="champ" value={f.resultat} onChange={(e) => set("resultat", e.target.value)}>
          <option value="">—</option>
          {RESULTATS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiquette" htmlFor="pa">Prochaine action</label>
          <input id="pa" list="actions" className="champ" value={f.prochaine_action} onChange={(e) => set("prochaine_action", e.target.value)} />
          <datalist id="actions">{ACTIONS.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
        <div><label className="etiquette">Date</label><ChampDate valeur={f.date_prochaine_action} onChange={(v) => set("date_prochaine_action", v)} /></div>
      </div>
      <div className="flex flex-wrap gap-1">
        {[["Demain", 1], ["+2 j", 2], ["+1 sem.", 7], ["+2 sem.", 14], ["+1 mois", 30]].map(([l, n]) => (
          <button type="button" key={l} className="btn-secondaire px-2 py-1 text-xs" onClick={() => set("date_prochaine_action", plusJours(aujourdhuiIso(), n as number))}>{l}</button>
        ))}
      </div>
      <div>
        <label className="etiquette" htmlFor="com">Commentaire</label>
        <textarea id="com" className="champ" rows={2} value={f.commentaire} onChange={(e) => set("commentaire", e.target.value)} placeholder="Contacts professionnels uniquement — aucune donnée d'identité personnelle" />
      </div>
      <button className="btn-primaire min-h-[48px] w-full text-base" disabled={envoi}>{envoi ? "Enregistrement…" : "Enregistrer l'interaction"}</button>
    </form>
  );
}
