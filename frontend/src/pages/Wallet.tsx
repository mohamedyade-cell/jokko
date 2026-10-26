import { useState } from "react";
import { Link } from "react-router-dom";
import { api, EntrepriseItem, Page, telecharger } from "../api";
import { useAuth } from "../auth";
import { BadgeCategorie, Chargement, Erreur, Modal, useApi, useToast } from "../components/ui";
import { fcfa, nombre, pct } from "../format";

interface Ligne {
  commercial_id: number; commercial: string; portefeuille: number; contactees: number; jointes: number; rdv: number; opportunites: number;
  clientes: number; montant_pipeline_fcfa: number; taux_couverture: number | null; par_categorie: Record<string, number>;
  objectifs: Record<string, number | null> | null;
}

function Progression({ v, obj }: { v: number; obj?: number | null }) {
  if (!obj) return <span>{nombre(v)}</span>;
  const p = Math.min(100, (100 * v) / obj);
  return (
    <div className="min-w-[90px]">
      <div className="text-right text-xs">{nombre(v)} / {nombre(obj)}</div>
      <div className="h-1.5 rounded bg-gray-100"><div className={`h-1.5 rounded ${p >= 100 ? "bg-green-600" : "bg-sunu"}`} style={{ width: `${p}%` }} /></div>
    </div>
  );
}

export default function Wallet() {
  const { user } = useAuth();
  const notifier = useToast();
  const resp = user.role === "responsable";
  const wallet = useApi<{ commerciaux: Ligne[]; non_attribuees: number }>("/api/wallet");
  const [cat, setCat] = useState("A,B");
  const cibles = useApi<Page<EntrepriseItem>>("/api/wallet/cibles", { categorie: cat, limite: 200 });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [dest, setDest] = useState("");
  const [objectifs, setObjectifs] = useState<Ligne | null>(null);
  const [obj, setObj] = useState<Record<string, string>>({});

  const attribuer = () => {
    if (!dest || selection.size === 0) return;
    api.post<{ attribuees: number }>("/api/wallet/attribuer", { ids: [...selection], commercial_id: Number(dest) })
      .then((r) => { notifier(`${r.attribuees} entreprise(s) attribuée(s)`); setSelection(new Set()); cibles.recharger(); wallet.recharger(); })
      .catch((e) => notifier(e.message, "erreur"));
  };
  const enregistrerObjectifs = () => {
    if (!objectifs) return;
    const corps = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === "" ? null : Number(v.replace(/\s/g, ""))]));
    api.put(`/api/wallet/objectifs/${objectifs.commercial_id}`, corps).then(() => { notifier("Objectifs enregistrés"); setObjectifs(null); wallet.recharger(); });
  };
  const toutes = cibles.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="titre">Sales Wallet</h1>
        <button className="btn-secondaire" onClick={() => telecharger("/api/exports/wallet", { format: "xlsx" })}>Excel</button>
      </div>
      <Erreur texte={wallet.erreur} />
      {!wallet.data ? <Chargement /> : (
        <div className="carte overflow-x-auto">
          <table className="tableau">
            <thead><tr><th>Commercial</th><th>Portefeuille</th><th>A / B / C / D</th><th>Contactées</th><th>Jointes</th><th>RDV</th><th>Opportunités</th><th>Clientes</th><th className="text-right">Pipeline</th><th className="text-right">Couverture</th>{resp && <th />}</tr></thead>
            <tbody>
              {wallet.data.commerciaux.map((l) => (
                <tr key={l.commercial_id}>
                  <td className="font-medium">{l.commercial}</td>
                  <td><Progression v={l.portefeuille} obj={l.objectifs?.portefeuille} /></td>
                  <td className="whitespace-nowrap text-xs">{["A", "B", "C", "D"].map((c) => l.par_categorie[c]).join(" / ")}</td>
                  <td><Progression v={l.contactees} obj={l.objectifs?.contacts} /></td>
                  <td>{nombre(l.jointes)}</td>
                  <td><Progression v={l.rdv} obj={l.objectifs?.rdv} /></td>
                  <td><Progression v={l.opportunites} obj={l.objectifs?.opportunites} /></td>
                  <td><Progression v={l.clientes} obj={l.objectifs?.clients} /></td>
                  <td className="text-right">{fcfa(l.montant_pipeline_fcfa)}</td>
                  <td className="text-right">{pct(l.taux_couverture)}</td>
                  {resp && <td><button className="btn-lien text-xs" onClick={() => { setObjectifs(l); setObj(Object.fromEntries(["portefeuille", "contacts", "rdv", "opportunites", "clients", "volume_fcfa"].map((k) => [k, l.objectifs?.[k] != null ? String(l.objectifs[k]) : ""]))); }}>Objectifs</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-500">{nombre(wallet.data.non_attribuees)} entreprise(s) active(s) non attribuée(s).</p>
        </div>
      )}

      <div className="carte">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Cibles prioritaires non attribuées <span className="text-sm font-normal text-gray-500">(vagues lancées, par score) — {nombre(cibles.data?.total)}</span></h2>
          <select className="champ w-40" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Catégories">
            <option value="A">Catégorie A</option><option value="A,B">A et B</option><option value="A,B,C">A, B et C</option><option value="A,B,C,D">Toutes</option>
          </select>
        </div>
        {resp && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-sunu-clair p-2 text-sm">
            <span>{selection.size} sélectionnée(s)</span>
            <button className="btn-secondaire px-2 py-1 text-xs" onClick={() => setSelection(new Set(toutes.map((e) => e.id)))}>Tout sélectionner</button>
            <button className="btn-secondaire px-2 py-1 text-xs" onClick={() => setSelection(new Set())}>Aucune</button>
            <select className="champ w-52" value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Attribuer à">
              <option value="">Attribuer à…</option>
              {wallet.data?.commerciaux.map((c) => <option key={c.commercial_id} value={c.commercial_id}>{c.commercial}</option>)}
            </select>
            <button className="btn-primaire" disabled={!dest || selection.size === 0} onClick={attribuer}>Attribuer</button>
          </div>
        )}
        <div className="max-h-[480px] overflow-auto">
          <table className="tableau">
            <thead><tr>{resp && <th />}<th>ID</th><th>Raison sociale</th><th>Segment</th><th>Taille</th><th>Région</th><th className="text-right">Score</th><th>Cat.</th><th>Vague</th></tr></thead>
            <tbody>
              {toutes.map((e) => (
                <tr key={e.id}>
                  {resp && <td><input type="checkbox" checked={selection.has(e.id)} aria-label={`Sélectionner ${e.id}`} onChange={(x) => { const s = new Set(selection); x.target.checked ? s.add(e.id) : s.delete(e.id); setSelection(s); }} /></td>}
                  <td className="font-mono text-xs"><Link className="btn-lien" to={`/entreprises/${e.id}`}>{e.id}</Link></td>
                  <td>{e.raison_sociale}</td><td>{e.segment}</td><td>{e.taille}</td><td>{e.region}</td>
                  <td className="text-right font-semibold">{e.score}</td><td><BadgeCategorie c={e.categorie} /></td><td>{e.vague}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Modal titre={`Objectifs — ${objectifs?.commercial ?? ""}`} ouvert={!!objectifs} onFermer={() => setObjectifs(null)}>
        <div className="grid gap-3 sm:grid-cols-2">
          {[["portefeuille", "Portefeuille (entreprises)"], ["contacts", "Entreprises contactées"], ["rdv", "RDV"], ["opportunites", "Opportunités"], ["clients", "Nouveaux clients"], ["volume_fcfa", "Volume FX (FCFA)"]].map(([k, l]) => (
            <div key={k}><label className="etiquette" htmlFor={`o-${k}`}>{l}</label><input id={`o-${k}`} className="champ" inputMode="numeric" value={obj[k] ?? ""} onChange={(e) => setObj({ ...obj, [k]: e.target.value })} /></div>
          ))}
        </div>
        <button className="btn-primaire mt-4" onClick={enregistrerObjectifs}>Enregistrer</button>
      </Modal>
    </div>
  );
}
