import { telecharger } from "../api";
import { useAuth } from "../auth";

const VUES = [
  ["entreprises", "Base entreprises (toute la base visible ; filtres disponibles depuis l'écran Base)"],
  ["interactions", "Interactions (Call Tracker)"],
  ["opportunites", "Pipeline / opportunités"],
  ["agenda", "Agenda (relances et RDV, 14 jours)"],
  ["wallet", "Sales Wallet (performance par commercial)"],
  ["anomalies", "Anomalies de qualité"],
  ["corrections", "Corrections tracées"],
];

export default function Exports() {
  const { user } = useAuth();
  const vues = user.role === "responsable" ? [...VUES, ["audit", "Journal d'audit (5 000 dernières lignes)"]] : VUES;
  return (
    <div className="space-y-4">
      <h1 className="titre">Exports</h1>
      <p className="text-sm text-gray-600">Chaque écran filtrable propose aussi ses boutons Excel / CSV, qui exportent exactement la vue filtrée. Chaque export est tracé dans le journal d'audit.</p>
      <div className="carte divide-y divide-gray-100 p-0">
        {vues.map(([v, l]) => (
          <div key={v} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span className="text-sm">{l}</span>
            <div className="flex gap-2">
              <button className="btn-secondaire" onClick={() => telecharger(`/api/exports/${v}`, { format: "xlsx" })}>Excel</button>
              <button className="btn-secondaire" onClick={() => telecharger(`/api/exports/${v}`, { format: "csv" })}>CSV</button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="text-sm font-medium">Rapport hebdomadaire (PDF)</span>
          <button className="btn-primaire" onClick={() => telecharger("/api/exports/rapport/hebdomadaire.pdf")}>Télécharger</button>
        </div>
      </div>
    </div>
  );
}
