import { FormEvent, useState } from "react";
import { api, ErreurApi, PRODUITS } from "../api";
import { ChampDate, Erreur, useToast } from "./ui";

export interface Qualif {
  devises: string[]; volume_annuel_fcfa: number | null; frequence: string | null; banque_actuelle: string | null;
  besoin_confirme: boolean | null; produits: string[]; import_confirme: boolean | null; export_confirme: boolean | null;
  potentiel: string | null; qualifiee: boolean; date_qualification: string | null; commentaire: string | null;
}

const DEVISES = ["EUR", "USD", "GBP", "CNY", "JPY", "Autre"];
const FREQ = ["Quotidienne", "Hebdomadaire", "Mensuelle", "Trimestrielle", "Ponctuelle"];
const POT = ["Élevé", "Moyen", "Faible"];

function TriEtat({ libelle, v, onChange }: { libelle: string; v: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <div>
      <span className="etiquette">{libelle}</span>
      <div className="flex gap-1">
        {([[true, "Oui"], [false, "Non"], [null, "Non confirmé"]] as const).map(([val, l]) => (
          <button type="button" key={l} onClick={() => onChange(val)} className={`flex-1 rounded border px-2 py-1.5 text-xs ${v === val ? "border-sunu bg-sunu text-white" : "border-gray-300"}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export default function FormQualification({ entrepriseId, initial, lectureSeule, onEnregistre }: { entrepriseId: string; initial: Qualif | null; lectureSeule: boolean; onEnregistre: () => void }) {
  const notifier = useToast();
  const [q, setQ] = useState<Qualif>(initial ?? { devises: [], volume_annuel_fcfa: null, frequence: null, banque_actuelle: null, besoin_confirme: null,
    produits: [], import_confirme: null, export_confirme: null, potentiel: null, qualifiee: false, date_qualification: null, commentaire: null });
  const [erreur, setErreur] = useState<string | null>(null);
  const set = <K extends keyof Qualif>(k: K, v: Qualif[K]) => setQ((x) => ({ ...x, [k]: v }));
  const basculer = (k: "devises" | "produits", v: string) => set(k, q[k].includes(v) ? q[k].filter((x) => x !== v) : [...q[k], v]);

  const envoyer = (e: FormEvent) => {
    e.preventDefault();
    api.put(`/api/entreprises/${entrepriseId}/qualification`, q)
      .then(() => { notifier("Qualification enregistrée — score recalculé"); onEnregistre(); })
      .catch((x: ErreurApi) => setErreur(x.message));
  };

  return (
    <form onSubmit={envoyer} className="space-y-4">
      <Erreur texte={erreur} />
      <p className="text-xs text-gray-500">Une valeur confirmée ici remplace toujours l'hypothèse dans le score.</p>
      <fieldset disabled={lectureSeule} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TriEtat libelle="Import confirmé" v={q.import_confirme} onChange={(v) => set("import_confirme", v)} />
          <TriEtat libelle="Export confirmé" v={q.export_confirme} onChange={(v) => set("export_confirme", v)} />
          <TriEtat libelle="Besoin de couverture confirmé" v={q.besoin_confirme} onChange={(v) => set("besoin_confirme", v)} />
          <div>
            <label className="etiquette" htmlFor="vol">Volume annuel FX (FCFA)</label>
            <input id="vol" className="champ" inputMode="numeric" value={q.volume_annuel_fcfa?.toLocaleString("fr-FR") ?? ""}
              onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "")); set("volume_annuel_fcfa", e.target.value.trim() ? n : null); }} />
          </div>
        </div>
        <div>
          <span className="etiquette">Devises</span>
          <div className="flex flex-wrap gap-1">{DEVISES.map((d) => (
            <button type="button" key={d} onClick={() => basculer("devises", d)} className={`rounded border px-3 py-1 text-sm ${q.devises.includes(d) ? "border-sunu bg-sunu-clair text-sunu" : "border-gray-300"}`}>{d}</button>
          ))}</div>
        </div>
        <div>
          <span className="etiquette">Produits</span>
          <div className="flex flex-wrap gap-1">{PRODUITS.map((p) => (
            <button type="button" key={p} onClick={() => basculer("produits", p)} className={`rounded border px-3 py-1 text-sm ${q.produits.includes(p) ? "border-sunu bg-sunu-clair text-sunu" : "border-gray-300"}`}>{p}</button>
          ))}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="etiquette" htmlFor="freq">Fréquence</label>
            <select id="freq" className="champ" value={q.frequence ?? ""} onChange={(e) => set("frequence", e.target.value || null)}><option value="">Non confirmée</option>{FREQ.map((f) => <option key={f}>{f}</option>)}</select></div>
          <div><label className="etiquette" htmlFor="pot">Potentiel</label>
            <select id="pot" className="champ" value={q.potentiel ?? ""} onChange={(e) => set("potentiel", e.target.value || null)}><option value="">Non confirmé</option>{POT.map((f) => <option key={f}>{f}</option>)}</select></div>
          <div><label className="etiquette" htmlFor="banque">Banque actuelle</label>
            <input id="banque" className="champ" value={q.banque_actuelle ?? ""} onChange={(e) => set("banque_actuelle", e.target.value || null)} /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.qualifiee} onChange={(e) => set("qualifiee", e.target.checked)} /> Entreprise qualifiée</label>
          <div><label className="etiquette">Date de qualification</label><ChampDate valeur={q.date_qualification} onChange={(v) => set("date_qualification", v)} /></div>
        </div>
        <div><label className="etiquette" htmlFor="qc">Commentaire</label><textarea id="qc" rows={2} className="champ" value={q.commentaire ?? ""} onChange={(e) => set("commentaire", e.target.value || null)} /></div>
        {!lectureSeule && <button className="btn-primaire">Enregistrer la qualification</button>}
      </fieldset>
    </form>
  );
}
