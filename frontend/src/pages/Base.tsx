import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EntrepriseItem, Page, telecharger } from "../api";
import { BadgeCategorie, Chargement, Erreur, Pagination, useApi } from "../components/ui";

export interface Filtres {
  segments: string[];
  tailles: string[];
  regions: string[];
  vagues: number[];
  categories: string[];
  statuts: Record<string, string>;
  statuts_validation: string[];
  commerciaux: { id: number; nom: string; role: string }[];
}

const CLES = ["q", "segment", "categorie", "vague", "taille", "region", "commercial_id", "statut", "statut_validation", "tri"];

export default function Base() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [page, setPage] = useState(1);
  const params: Record<string, string> = {};
  CLES.forEach((k) => sp.get(k) && (params[k] = sp.get(k)!));
  const filtres = useApi<Filtres>("/api/entreprises-filtres");
  const { data, erreur, chargement } = useApi<Page<EntrepriseItem>>("/api/entreprises", { ...params, page, taille_page: 50 });

  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) {
        const n = new URLSearchParams(sp);
        q ? n.set("q", q) : n.delete("q");
        setSp(n, { replace: true });
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const changer = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    v ? n.set(k, v) : n.delete(k);
    setSp(n, { replace: true });
    setPage(1);
  };
  const f = filtres.data;
  const select = (k: string, libelle: string, options: [string, string][]) => (
    <select className="champ" value={sp.get(k) ?? ""} onChange={(e) => changer(k, e.target.value)} aria-label={libelle}>
      <option value="">{libelle}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="titre">Base entreprises</h1>
        <div className="flex gap-2">
          <button className="btn-secondaire" onClick={() => telecharger("/api/exports/entreprises", { ...params, format: "xlsx" })}>Excel</button>
          <button className="btn-secondaire" onClick={() => telecharger("/api/exports/entreprises", { ...params, format: "csv" })}>CSV</button>
        </div>
      </div>
      <div className="carte space-y-3">
        <input className="champ text-base" placeholder="Rechercher : nom, sigle, NINEA, RCCM, téléphone, ID…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Recherche" autoFocus />
        {f && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            {select("segment", "Segment", f.segments.map((s) => [s, s]))}
            {select("categorie", "Catégorie", f.categories.map((c) => [c, `Catégorie ${c}`]))}
            {select("vague", "Vague", f.vagues.map((v) => [String(v), `Vague ${v}`]))}
            {select("taille", "Taille", f.tailles.map((t) => [t, t]))}
            {select("region", "Région", f.regions.map((r) => [r, r]))}
            {select("commercial_id", "Commercial", f.commerciaux.map((c) => [String(c.id), c.nom]))}
            {select("statut", "Statut commercial", Object.entries(f.statuts))}
            {select("statut_validation", "Validation", f.statuts_validation.map((s) => [s, s]))}
          </div>
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Tri :</span>
          {select("tri", "Score décroissant", [["nom", "Nom"], ["id", "ID"], ["vague", "Vague"], ["-score", "Score croissant"]])}
          {Object.keys(params).length > 0 && <button className="btn-lien text-sm" onClick={() => { setQ(""); setSp(new URLSearchParams()); }}>Réinitialiser</button>}
        </div>
      </div>
      <Erreur texte={erreur} />
      {!data && chargement && <Chargement />}
      {data && (
        <div className="carte overflow-x-auto p-0">
          <table className="tableau">
            <thead>
              <tr><th>ID</th><th>Raison sociale</th><th>NINEA</th><th>RCCM</th><th>NAEMA</th><th>Téléphone</th><th>Segment</th><th>Taille</th><th>Région</th><th className="text-right">Score</th><th>Cat.</th><th>Vague</th><th>Commercial</th></tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id} className="hover:bg-sunu-clair/40">
                  <td className="whitespace-nowrap font-mono text-xs"><Link className="btn-lien" to={`/entreprises/${e.id}`}>{e.id}</Link></td>
                  <td className="max-w-xs"><Link to={`/entreprises/${e.id}`} className="font-medium hover:text-sunu">{e.raison_sociale}</Link>{e.sigle && <span className="text-gray-400"> ({e.sigle})</span>}
                    {e.statut_validation !== "Validée" && <span className="badge ml-1 bg-yellow-100 text-yellow-800">À vérifier</span>}
                    {e.est_cliente && <span className="badge ml-1 bg-green-100 text-green-800">Cliente</span>}</td>
                  <td className="whitespace-nowrap">{e.ninea}</td>
                  <td className="whitespace-nowrap">{e.rccm}</td>
                  <td className="whitespace-nowrap">{e.naema_code}</td>
                  <td className="whitespace-nowrap">{e.telephone && <a href={`tel:${e.telephone.replace(/\s/g, "")}`} className="hover:text-sunu">{e.telephone}</a>}</td>
                  <td>{e.segment}</td>
                  <td>{e.taille}</td>
                  <td>{e.region}</td>
                  <td className="text-right font-semibold tabular-nums">{e.score}</td>
                  <td><BadgeCategorie c={e.categorie} /></td>
                  <td className="text-center">{e.vague}</td>
                  <td className="whitespace-nowrap">{e.commercial ?? <span className="text-gray-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3"><Pagination page={page} total={data.total} taille={50} onPage={setPage} /></div>
        </div>
      )}
    </div>
  );
}
