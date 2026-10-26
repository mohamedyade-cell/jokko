import { useState } from "react";
import { Link } from "react-router-dom";
import { api, Interaction, telecharger } from "../api";
import { useAuth } from "../auth";
import { BadgeCategorie, Chargement, Erreur, useApi, useToast } from "../components/ui";
import { dateFr } from "../format";

type Ligne = Interaction & { commercial_entreprise: string | null };
interface AgendaData { date: string; en_retard: Ligne[]; aujourdhui: Ligne[]; a_venir: Ligne[]; rdv: Ligne[]; totaux: Record<string, number> }

function Liste({ titre, lignes, total, couleur, rdv, onFait }: { titre: string; lignes: Ligne[]; total: number; couleur: string; rdv?: boolean; onFait?: (id: number) => void }) {
  return (
    <div className="carte">
      <h2 className={`mb-2 font-semibold ${couleur}`}>{titre} <span className="text-sm font-normal text-gray-500">({total})</span></h2>
      {lignes.length === 0 && <p className="text-sm text-gray-500">Rien à signaler.</p>}
      <ul className="divide-y divide-gray-100">
        {lignes.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <Link to={`/entreprises/${l.entreprise_id}`} className="font-medium hover:text-sunu">{l.raison_sociale}</Link> <BadgeCategorie c={l.categorie ?? "D"} />
              <div className="text-xs text-gray-500">
                {rdv ? `RDV le ${dateFr(l.date_rdv)}` : `${l.prochaine_action} — ${dateFr(l.date_prochaine_action)}`}
                {" · "}{l.commercial ?? l.commercial_entreprise ?? "—"}
                {l.telephone && <> · <a className="btn-lien" href={`tel:${l.telephone.replace(/\s/g, "")}`}>{l.telephone}</a></>}
              </div>
            </div>
            {onFait && <button className="btn-secondaire shrink-0 px-2 py-1 text-xs" onClick={() => onFait(l.id)}>Fait</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Agenda() {
  const { user } = useAuth();
  const notifier = useToast();
  const [commercial, setCommercial] = useState("");
  const [jours, setJours] = useState(14);
  const { data, erreur, recharger } = useApi<AgendaData>("/api/agenda", { commercial_id: commercial || undefined, jours });
  const filtres = useApi<{ commerciaux: { id: number; nom: string; role: string }[] }>("/api/entreprises-filtres");
  const fait = user.role !== "lecture" ? (id: number) => api.post(`/api/interactions/${id}/fait`).then(() => { notifier("Relance soldée"); recharger(); }).catch((e) => notifier(e.message, "erreur")) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="titre">Agenda {data && <span className="text-sm font-normal text-gray-500">du {dateFr(data.date)}</span>}</h1>
        <div className="flex flex-wrap gap-2">
          {user.role !== "fx_sales" && (
            <select className="champ w-52" value={commercial} onChange={(e) => setCommercial(e.target.value)} aria-label="Commercial">
              <option value="">Tous les commerciaux</option>
              {filtres.data?.commerciaux.filter((c) => c.role === "fx_sales").map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          )}
          <select className="champ w-36" value={jours} onChange={(e) => setJours(Number(e.target.value))} aria-label="Horizon">
            <option value={7}>7 jours</option><option value={14}>14 jours</option><option value={30}>30 jours</option>
          </select>
          <button className="btn-secondaire" onClick={() => telecharger("/api/exports/agenda", { commercial_id: commercial || undefined, jours, format: "xlsx" })}>Excel</button>
        </div>
      </div>
      <Erreur texte={erreur} />
      {!data ? <Chargement /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Liste titre="En retard" lignes={data.en_retard} total={data.totaux.en_retard} couleur="text-sunu" onFait={fait} />
          <Liste titre="Aujourd'hui" lignes={data.aujourdhui} total={data.totaux.aujourdhui} couleur="text-gray-900" onFait={fait} />
          <Liste titre="Rendez-vous" lignes={data.rdv} total={data.totaux.rdv} couleur="text-gray-900" rdv />
          <Liste titre="À venir" lignes={data.a_venir} total={data.totaux.a_venir} couleur="text-gray-700" onFait={fait} />
        </div>
      )}
    </div>
  );
}
