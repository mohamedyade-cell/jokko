import { useState } from "react";
import { Link } from "react-router-dom";
import { api, EntrepriseItem, telecharger } from "../api";
import { useAuth } from "../auth";
import { BadgeCategorie, Chargement, useApi, useToast } from "../components/ui";
import { dateHeureFr } from "../format";

interface Anomalie { entreprise_id: string; raison_sociale: string; type: string; champ: string | null; valeur: string | null }
interface Correction { id: number; entreprise_id: string; champ: string; avant: string | null; apres: string | null; auteur: string; date: string; motif: string | null; origine: string }

export default function Qualite() {
  const { user } = useAuth();
  const notifier = useToast();
  const [onglet, setOnglet] = useState<"anomalies" | "verifier" | "echantillon" | "corrections">("anomalies");
  const [type, setType] = useState("");
  const [graine, setGraine] = useState("");
  const anomalies = useApi<{ par_type: Record<string, number>; items: Anomalie[] }>(onglet === "anomalies" ? "/api/qualite/anomalies" : null, { type: type || undefined });
  const verifier = useApi<{ total: number; items: EntrepriseItem[] }>(onglet === "verifier" ? "/api/qualite/a-verifier" : null);
  const echantillon = useApi<{ graine: string; taille: number; items: EntrepriseItem[] }>(onglet === "echantillon" ? "/api/qualite/echantillon" : null, { graine: graine || undefined });
  const corrections = useApi<Correction[]>(onglet === "corrections" ? "/api/qualite/corrections" : null);
  const valider = (id: string) => api.post(`/api/qualite/${id}/valider`, {}).then(() => { notifier(`${id} validée`); verifier.recharger(); }).catch((e) => notifier(e.message, "erreur"));

  const tableEntreprises = (items: EntrepriseItem[], action?: boolean) => (
    <table className="tableau">
      <thead><tr><th>ID</th><th>Raison sociale</th><th>NINEA</th><th>RCCM</th><th>Téléphone</th><th>Segment</th><th>Cat.</th><th>Validation</th>{action && <th />}</tr></thead>
      <tbody>{items.map((e) => (
        <tr key={e.id}><td className="font-mono text-xs"><Link className="btn-lien" to={`/entreprises/${e.id}`}>{e.id}</Link></td><td>{e.raison_sociale}</td><td>{e.ninea}</td><td>{e.rccm}</td><td>{e.telephone}</td><td>{e.segment}</td><td><BadgeCategorie c={e.categorie} /></td><td>{e.statut_validation}</td>
          {action && <td>{user.role !== "lecture" && <button className="btn-secondaire px-2 py-1 text-xs" onClick={() => valider(e.id)}>Valider</button>}</td>}</tr>
      ))}</tbody>
    </table>
  );

  return (
    <div className="space-y-4">
      <h1 className="titre">Contrôle qualité</h1>
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {([["anomalies", "Anomalies"], ["verifier", "Fiches à vérifier"], ["echantillon", "Échantillon de contrôle"], ["corrections", "Corrections tracées"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setOnglet(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${onglet === k ? "border-sunu font-semibold text-sunu" : "border-transparent text-gray-600"}`}>{l}</button>
        ))}
      </div>
      {onglet === "anomalies" && (anomalies.data ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button className={!type ? "btn-primaire" : "btn-secondaire"} onClick={() => setType("")}>Toutes</button>
            {Object.entries(anomalies.data.par_type).map(([t, n]) => <button key={t} className={type === t ? "btn-primaire" : "btn-secondaire"} onClick={() => setType(t)}>{t} ({n})</button>)}
            <button className="btn-secondaire ml-auto" onClick={() => telecharger("/api/exports/anomalies", { type: type || undefined, format: "xlsx" })}>Excel</button>
          </div>
          <div className="carte overflow-x-auto p-0">
            <table className="tableau"><thead><tr><th>ID</th><th>Raison sociale</th><th>Anomalie</th><th>Champ</th><th>Valeur</th></tr></thead>
              <tbody>{anomalies.data.items.map((a, i) => <tr key={i}><td className="font-mono text-xs"><Link className="btn-lien" to={`/entreprises/${a.entreprise_id}`}>{a.entreprise_id}</Link></td><td>{a.raison_sociale}</td><td>{a.type}</td><td>{a.champ}</td><td>{a.valeur}</td></tr>)}</tbody></table>
          </div>
        </div>) : <Chargement />)}
      {onglet === "verifier" && (verifier.data ? <div className="carte overflow-x-auto p-0"><div className="p-3 text-sm text-gray-600">{verifier.data.total} fiche(s) à vérifier</div>{tableEntreprises(verifier.data.items, true)}</div> : <Chargement />)}
      {onglet === "echantillon" && (echantillon.data ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Échantillon de {echantillon.data.taille} entreprises tirées au hasard — graine <b>{echantillon.data.graine}</b> (même graine = même échantillon).</span>
            <input className="champ w-40" placeholder="Autre graine" value={graine} onChange={(e) => setGraine(e.target.value)} />
          </div>
          <div className="carte overflow-x-auto p-0">{tableEntreprises(echantillon.data.items, true)}</div>
        </div>) : <Chargement />)}
      {onglet === "corrections" && (corrections.data ? (
        <div className="carte overflow-x-auto p-0">
          <div className="flex justify-end p-2"><button className="btn-secondaire" onClick={() => telecharger("/api/exports/corrections", { format: "xlsx" })}>Excel</button></div>
          <table className="tableau"><thead><tr><th>Date</th><th>ID</th><th>Champ</th><th>Avant</th><th>Après</th><th>Auteur</th><th>Motif</th><th>Origine</th></tr></thead>
            <tbody>{corrections.data.map((c) => <tr key={c.id}><td className="whitespace-nowrap">{dateHeureFr(c.date)}</td><td className="font-mono text-xs"><Link className="btn-lien" to={`/entreprises/${c.entreprise_id}`}>{c.entreprise_id}</Link></td><td>{c.champ}</td><td className="text-gray-500 line-through">{c.avant}</td><td>{c.apres}</td><td>{c.auteur}</td><td>{c.motif}</td><td>{c.origine}</td></tr>)}</tbody></table>
        </div>) : <Chargement />)}
    </div>
  );
}
