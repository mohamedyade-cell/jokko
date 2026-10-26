import { useState } from "react";
import { telecharger } from "../api";
import { Chargement, Erreur, useApi } from "../components/ui";
import { dateHeureFr } from "../format";

interface Ligne { id: number; horodatage: string; utilisateur: string; action: string; table: string; enregistrement_id: string; ancienne_valeur: Record<string, unknown> | null; nouvelle_valeur: Record<string, unknown> | null }

function Valeurs({ v }: { v: Record<string, unknown> | null }) {
  if (!v) return <span className="text-gray-400">—</span>;
  return <div className="max-w-md space-y-0.5 text-xs">{Object.entries(v).map(([k, x]) => <div key={k}><span className="text-gray-500">{k} :</span> {typeof x === "object" ? JSON.stringify(x) : String(x ?? "∅")}</div>)}</div>;
}

export default function Audit() {
  const [f, setF] = useState({ table: "", utilisateur: "", enregistrement_id: "", action: "" });
  const { data, erreur } = useApi<Ligne[]>("/api/audit", { ...f, limite: 300 });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="titre">Journal d'audit</h1>
        <button className="btn-secondaire" onClick={() => telecharger("/api/exports/audit", { ...f, format: "xlsx" })}>Excel</button></div>
      <p className="text-sm text-gray-600">Chaque création, modification et suppression est enregistrée (utilisateur, date, ancienne et nouvelle valeur). Le journal est en ajout seul.</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <select className="champ" value={f.table} onChange={(e) => setF({ ...f, table: e.target.value })} aria-label="Table">
          <option value="">Toutes les tables</option>
          {["entreprises", "interactions", "qualifications", "opportunites", "corrections", "doublons", "parametres", "segments", "tailles", "utilisateurs", "objectifs", "entite_alias", "imports"].map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="champ" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} aria-label="Action">
          <option value="">Toutes les actions</option>{["CREATION", "MODIFICATION", "SUPPRESSION", "IMPORT", "EXPORT"].map((a) => <option key={a}>{a}</option>)}
        </select>
        <input className="champ" placeholder="Utilisateur" value={f.utilisateur} onChange={(e) => setF({ ...f, utilisateur: e.target.value })} />
        <input className="champ" placeholder="ID enregistrement (ex. ENT-00001)" value={f.enregistrement_id} onChange={(e) => setF({ ...f, enregistrement_id: e.target.value.toUpperCase() })} />
      </div>
      <Erreur texte={erreur} />
      {!data ? <Chargement /> : (
        <div className="carte overflow-x-auto p-0">
          <table className="tableau">
            <thead><tr><th>Horodatage</th><th>Utilisateur</th><th>Action</th><th>Table</th><th>Enregistrement</th><th>Ancienne valeur</th><th>Nouvelle valeur</th></tr></thead>
            <tbody>{data.map((l) => (
              <tr key={l.id} className="align-top"><td className="whitespace-nowrap">{dateHeureFr(l.horodatage)}</td><td>{l.utilisateur}</td><td>{l.action}</td><td>{l.table}</td><td className="font-mono text-xs">{l.enregistrement_id}</td><td><Valeurs v={l.ancienne_valeur} /></td><td><Valeurs v={l.nouvelle_valeur} /></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
