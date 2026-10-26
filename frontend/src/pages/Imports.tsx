import { FormEvent, useState } from "react";
import { api, ErreurApi } from "../api";
import { Erreur, useApi } from "../components/ui";
import { dateHeureFr } from "../format";

interface Rapport {
  resume: Record<string, unknown>;
  nouvelles_entreprises: string[];
  ids_fusionnes: { ancien_id: string; nouvel_id: string; interactions: number; opportunites: number }[];
  absentes: string[];
  anomalies: { type: string; message: string; onglet: string | null; ligne: number | null; entreprise_id: string | null }[];
  saisies: Record<string, Record<string, number>>;
  colonnes_non_reconnues: Record<string, string[]>;
  parametres: { importes: string[]; conserves_application: string[] };
  divergences_classeur: { score: number; categorie: number; vague: number; exemples: { id: string; ecarts: string[] }[] };
}

const LIBELLES: Record<string, string> = {
  nouvelles_entreprises: "Nouvelles entreprises", ids_fusionnes: "ID fusionnés", entreprises_absentes_du_classeur: "Absentes du classeur (conservées)",
  entreprises_mises_a_jour: "Entreprises mises à jour", entreprises_inchangees: "Inchangées", valeurs_protegees_non_ecrasees: "Saisies protégées (non écrasées)",
  saisies_realignees_par_alias: "Saisies réalignées par alias", fiches: "Fiches PDF", fichiers_pdf: "Fichiers PDF", total_entreprises: "Total entreprises",
  entreprises_actives: "Entreprises actives", nb_anomalies: "Anomalies", lignes_base: "Lignes Base",
};

function AfficherRapport({ r }: { r: Rapport }) {
  const res = r.resume;
  return (
    <div className="space-y-4">
      {res.jeu_fictif === true && <div className="rounded bg-yellow-200 px-3 py-1 text-sm font-semibold">Jeu de données FICTIF</div>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Object.entries(LIBELLES).filter(([k]) => res[k] !== undefined).map(([k, l]) => (
          <div key={k} className="rounded border border-gray-200 bg-white p-2"><div className="text-xs text-gray-500">{l}</div><div className="text-lg font-semibold">{String(res[k])}</div></div>
        ))}
      </div>
      <div className="carte"><h3 className="mb-2 font-semibold">Saisies importées</h3>
        <table className="tableau"><tbody>{Object.entries(r.saisies).map(([o, c]) => <tr key={o}><td className="font-medium">{o}</td><td>{Object.entries(c).map(([k, v]) => `${k.replace(/_/g, " ")} : ${v}`).join(" · ")}</td></tr>)}</tbody></table>
      </div>
      {r.ids_fusionnes.length > 0 && <div className="carte"><h3 className="mb-2 font-semibold">ID fusionnés (alias moteur)</h3><ul className="text-sm">{r.ids_fusionnes.map((f) => <li key={f.ancien_id}>{f.ancien_id} → {f.nouvel_id} ({f.interactions} interaction(s), {f.opportunites} opportunité(s) réalignées)</li>)}</ul></div>}
      {r.nouvelles_entreprises.length > 0 && <div className="carte"><h3 className="mb-2 font-semibold">Nouvelles entreprises ({r.nouvelles_entreprises.length})</h3><p className="text-xs text-gray-600">{r.nouvelles_entreprises.slice(0, 100).join(", ")}{r.nouvelles_entreprises.length > 100 && "…"}</p></div>}
      {r.absentes.length > 0 && <div className="carte"><h3 className="mb-2 font-semibold">Absentes du classeur (jamais supprimées)</h3><p className="text-xs text-gray-600">{r.absentes.join(", ")}</p></div>}
      <div className="carte"><h3 className="mb-2 font-semibold">Écarts avec les calculs du classeur</h3>
        <p className="text-sm">Score : {r.divergences_classeur.score ?? 0} · Catégorie : {r.divergences_classeur.categorie ?? 0} · Vague : {r.divergences_classeur.vague ?? 0}</p>
        <ul className="mt-1 text-xs text-gray-600">{(r.divergences_classeur.exemples ?? []).slice(0, 20).map((x) => <li key={x.id}>{x.id} : {x.ecarts.join(", ")}</li>)}</ul></div>
      {Object.keys(r.colonnes_non_reconnues).length > 0 && <div className="carte"><h3 className="mb-2 font-semibold">Colonnes non reconnues</h3><ul className="text-sm">{Object.entries(r.colonnes_non_reconnues).map(([o, c]) => <li key={o}><b>{o}</b> : {c.join(", ")}</li>)}</ul></div>}
      <div className="carte"><h3 className="mb-2 font-semibold">Anomalies ({r.anomalies.length})</h3>
        <div className="max-h-80 overflow-auto"><table className="tableau"><thead><tr><th>Type</th><th>Onglet</th><th>Ligne</th><th>ID</th><th>Message</th></tr></thead>
          <tbody>{r.anomalies.slice(0, 500).map((a, i) => <tr key={i}><td>{a.type}</td><td>{a.onglet}</td><td>{a.ligne}</td><td>{a.entreprise_id}</td><td>{a.message}</td></tr>)}</tbody></table></div></div>
    </div>
  );
}

export default function Imports() {
  const historique = useApi<{ id: number; debut: string; utilisateur: string; fichier_excel: string | null; fichier_db: string | null; statut: string }[]>("/api/imports");
  const [classeur, setClasseur] = useState<File | null>(null);
  const [radar, setRadar] = useState<File | null>(null);
  const [simulation, setSimulation] = useState(true);
  const [rapport, setRapport] = useState<Rapport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const envoyer = (e: FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    if (classeur) fd.append("classeur", classeur);
    if (radar) fd.append("radar_db", radar);
    fd.append("simulation", String(simulation));
    setEnvoi(true);
    setErreur(null);
    api.post<Rapport>("/api/imports", fd).then((r) => { setRapport(r); historique.recharger(); }).catch((x: ErreurApi) => setErreur(x.message)).finally(() => setEnvoi(false));
  };
  const ouvrir = (id: number) => api.get<{ rapport: Rapport }>(`/api/imports/${id}`).then((r) => setRapport(r.rapport));

  return (
    <div className="space-y-4">
      <h1 className="titre">Imports</h1>
      <form onSubmit={envoyer} className="carte space-y-3">
        <p className="text-sm text-gray-600">Import idempotent : aucun ID n'est recréé ni supprimé, les alias du moteur sont appliqués, les saisies faites dans l'application ne sont jamais écrasées. Commencez par une simulation.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="etiquette" htmlFor="xl">Classeur SUNU_FX_SALES_RADAR.xlsx</label><input id="xl" type="file" accept=".xlsx,.xlsm" onChange={(e) => setClasseur(e.target.files?.[0] ?? null)} /></div>
          <div><label className="etiquette" htmlFor="rdb">radar.db (moteur)</label><input id="rdb" type="file" accept=".db,.sqlite,.sqlite3" onChange={(e) => setRadar(e.target.files?.[0] ?? null)} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={simulation} onChange={(e) => setSimulation(e.target.checked)} /> Simulation (rapport sans enregistrement)</label>
        <Erreur texte={erreur} />
        <button className="btn-primaire" disabled={envoi || (!classeur && !radar)}>{envoi ? "Import en cours…" : simulation ? "Simuler l'import" : "Importer"}</button>
      </form>
      {rapport && <AfficherRapport r={rapport} />}
      <div className="carte"><h2 className="mb-2 font-semibold">Historique</h2>
        <table className="tableau"><thead><tr><th>Date</th><th>Par</th><th>Classeur</th><th>radar.db</th><th>Statut</th><th /></tr></thead>
          <tbody>{historique.data?.map((h) => <tr key={h.id}><td>{dateHeureFr(h.debut)}</td><td>{h.utilisateur}</td><td>{h.fichier_excel}</td><td>{h.fichier_db}</td><td>{h.statut}</td><td><button className="btn-lien text-sm" onClick={() => ouvrir(h.id)}>Rapport</button></td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
