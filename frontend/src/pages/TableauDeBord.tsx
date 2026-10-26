import { useState } from "react";
import { telecharger } from "../api";
import { useAuth } from "../auth";
import { Barres, Chargement, Colonnes, Erreur, Kpi, useApi } from "../components/ui";
import { dateFr, fcfa, nombre, pct } from "../format";

interface Repartition { cle: string | number; total: number; contactees: number }
interface Serie { periode: string; debut: string; interactions: number; contactees: number; jointes: number; rdv: number; opportunites: number }
interface Perf {
  commercial_id: number; commercial: string; portefeuille: number; contactees: number; jointes: number; decideur: number;
  qualifiees: number; rdv: number; opportunites: number; clientes: number; interactions: number; interactions_7j: number;
  montant_pipeline_fcfa: number; taux_couverture: number | null; taux_joignabilite: number | null;
  objectifs: Record<string, number | null> | null;
}
interface Dashboard {
  date: string;
  volumes: { fiches: number; entreprises_uniques: number; base_validee: number; interactions: number };
  entonnoir: { etape: string; libelle: string; valeur: number }[];
  couverture: { base_validee: number; contactees_base_validee: number; reelle_pct: number | null; objectif_pct: number; objectif_entreprises: number; duree_mois: number; date_lancement: string | null; attendu_a_date_pct: number | null };
  taux: { joignabilite: number | null; rdv: number | null; conversion: number | null };
  repartition: { categorie: Repartition[]; segment: Repartition[]; vague: Repartition[] };
  hebdomadaire: Serie[];
  mensuel: Serie[];
  pipeline: { opportunites_ouvertes: number; montant_ouvert_fcfa: number; montant_pondere_fcfa: number; pnb_estime_fcfa: number; gagnees: number };
  performance: Perf[];
}

const SERIES = [
  { cle: "contactees", libelle: "Contactées", couleur: "bg-gray-300" },
  { cle: "jointes", libelle: "Jointes", couleur: "bg-red-300" },
  { cle: "rdv", libelle: "RDV", couleur: "bg-sunu" },
];

export default function TableauDeBord() {
  const { user } = useAuth();
  const [commercial, setCommercial] = useState<string>("");
  const [vueSerie, setVueSerie] = useState<"hebdomadaire" | "mensuel">("hebdomadaire");
  const { data, erreur } = useApi<Dashboard>("/api/dashboard", { commercial_id: commercial || undefined });
  const filtres = useApi<{ commerciaux: { id: number; nom: string; role: string }[] }>("/api/entreprises-filtres");

  if (erreur) return <Erreur texte={erreur} />;
  if (!data) return <Chargement />;
  const c = data.couverture;
  const entonnoirMax = Math.max(1, ...data.entonnoir.map((e) => e.valeur));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="titre">Tableau de bord <span className="text-sm font-normal text-gray-500">au {dateFr(data.date)}</span></h1>
        <div className="flex gap-2">
          {user.role !== "fx_sales" && (
            <select className="champ w-56" value={commercial} onChange={(e) => setCommercial(e.target.value)} aria-label="Périmètre">
              <option value="">Toute l'équipe</option>
              {filtres.data?.commerciaux.filter((u) => u.role === "fx_sales").map((u) => <option key={u.id} value={u.id}>{u.nom}</option>)}
            </select>
          )}
          <button className="btn-secondaire" onClick={() => telecharger("/api/exports/rapport/hebdomadaire.pdf", { commercial_id: commercial || undefined })}>Rapport PDF</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi libelle="Fiches extraites" valeur={nombre(data.volumes.fiches)} />
        <Kpi libelle="Entreprises uniques" valeur={nombre(data.volumes.entreprises_uniques)} />
        <Kpi libelle="Base validée" valeur={nombre(data.volumes.base_validee)} />
        <Kpi libelle="Interactions" valeur={nombre(data.volumes.interactions)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="carte lg:col-span-2">
          <h2 className="mb-3 font-semibold">Entonnoir commercial</h2>
          <div className="space-y-1.5">
            {data.entonnoir.map((e, i) => (
              <div key={e.etape} className="flex items-center gap-2 text-sm">
                <div className="w-32 shrink-0 text-gray-600">{e.libelle}</div>
                <div className="h-6 flex-1 rounded bg-gray-100">
                  <div className="h-6 rounded bg-sunu" style={{ width: `${Math.max(1, (100 * e.valeur) / entonnoirMax)}%`, opacity: 1 - i * 0.06 }} />
                </div>
                <span className="w-14 text-right text-sm font-semibold tabular-nums">{nombre(e.valeur)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-500">Chaque étape compte les entreprises actives ayant atteint ce stade (définitions dans le guide utilisateur).</p>
        </div>
        <div className="space-y-3">
          <div className="carte">
            <h2 className="font-semibold">Couverture de la base validée</h2>
            <div className="mt-2 text-3xl font-bold text-sunu">{pct(c.reelle_pct)}</div>
            <div className="text-xs text-gray-500">{nombre(c.contactees_base_validee)} contactées / {nombre(c.base_validee)}</div>
            <div className="relative mt-3 h-3 rounded bg-gray-100">
              <div className="absolute inset-y-0 left-0 rounded bg-sunu" style={{ width: `${Math.min(100, c.reelle_pct ?? 0)}%` }} />
              {c.attendu_a_date_pct !== null && (
                <div className="absolute -top-1 h-5 w-0.5 bg-gray-800" style={{ left: `${Math.min(100, c.attendu_a_date_pct)}%` }} title="Attendu à date" />
              )}
              <div className="absolute -top-1 h-5 w-0.5 bg-gray-400" style={{ left: `${Math.min(100, c.objectif_pct)}%` }} title="Objectif" />
            </div>
            <div className="mt-2 text-xs text-gray-600">
              Objectif {pct(c.objectif_pct)} en {nombre(c.duree_mois)} mois ({nombre(c.objectif_entreprises)} entreprises)
              {c.date_lancement && <> · lancement {dateFr(c.date_lancement)} · attendu à date {pct(c.attendu_a_date_pct)}</>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Kpi libelle="Joignabilité" valeur={pct(data.taux.joignabilite)} />
            <Kpi libelle="RDV" valeur={pct(data.taux.rdv)} />
            <Kpi libelle="Conversion" valeur={pct(data.taux.conversion)} />
          </div>
        </div>
      </div>

      <div className="carte">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Suivi {vueSerie === "hebdomadaire" ? "hebdomadaire (12 semaines)" : "mensuel (12 mois)"}</h2>
          <div className="flex gap-1">
            <button className={vueSerie === "hebdomadaire" ? "btn-primaire" : "btn-secondaire"} onClick={() => setVueSerie("hebdomadaire")}>Semaines</button>
            <button className={vueSerie === "mensuel" ? "btn-primaire" : "btn-secondaire"} onClick={() => setVueSerie("mensuel")}>Mois</button>
          </div>
        </div>
        <Colonnes donnees={data[vueSerie] as unknown as Record<string, number | string>[]} series={SERIES} />
        <div className="mt-4 overflow-x-auto">
          <table className="tableau">
            <thead><tr><th>Période</th><th className="text-right">Interactions</th><th className="text-right">Contactées</th><th className="text-right">Jointes</th><th className="text-right">RDV</th><th className="text-right">Opportunités</th></tr></thead>
            <tbody>
              {data[vueSerie].map((s) => (
                <tr key={s.debut}><td>{s.periode}</td><td className="text-right">{s.interactions}</td><td className="text-right">{s.contactees}</td><td className="text-right">{s.jointes}</td><td className="text-right">{s.rdv}</td><td className="text-right">{s.opportunites}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="carte">
          <h2 className="mb-3 font-semibold">Par catégorie <span className="text-xs font-normal text-gray-500">(total / contactées)</span></h2>
          <Barres donnees={data.repartition.categorie.map((r) => ({ libelle: `Catégorie ${r.cle}`, valeur: r.total, secondaire: r.contactees }))} />
        </div>
        <div className="carte">
          <h2 className="mb-3 font-semibold">Par vague</h2>
          <Barres donnees={data.repartition.vague.map((r) => ({ libelle: `Vague ${r.cle}`, valeur: r.total, secondaire: r.contactees }))} />
        </div>
        <div className="carte">
          <h2 className="mb-3 font-semibold">Par segment</h2>
          <Barres donnees={data.repartition.segment.map((r) => ({ libelle: String(r.cle), valeur: r.total, secondaire: r.contactees }))} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi libelle="Opportunités ouvertes" valeur={nombre(data.pipeline.opportunites_ouvertes)} detail={`${nombre(data.pipeline.gagnees)} gagnée(s)`} />
        <Kpi libelle="Pipeline ouvert" valeur={fcfa(data.pipeline.montant_ouvert_fcfa)} />
        <Kpi libelle="Pipeline pondéré" valeur={fcfa(data.pipeline.montant_pondere_fcfa)} />
        <Kpi libelle="PNB estimé" valeur={fcfa(data.pipeline.pnb_estime_fcfa)} detail="montant × marge (pb)" />
      </div>

      <div className="carte overflow-x-auto">
        <h2 className="mb-3 font-semibold">Performance par commercial</h2>
        <table className="tableau">
          <thead>
            <tr><th>Commercial</th><th className="text-right">Portefeuille</th><th className="text-right">Contactées</th><th className="text-right">Jointes</th><th className="text-right">Décideur</th><th className="text-right">Qualifiées</th><th className="text-right">RDV</th><th className="text-right">Opp.</th><th className="text-right">Clientes</th><th className="text-right">Interactions (7 j)</th><th className="text-right">Pipeline</th><th className="text-right">Couverture</th></tr>
          </thead>
          <tbody>
            {data.performance.map((p) => (
              <tr key={p.commercial_id}>
                <td className="font-medium">{p.commercial}</td>
                <td className="text-right">{nombre(p.portefeuille)}{p.objectifs?.portefeuille ? <span className="text-gray-400"> / {p.objectifs.portefeuille}</span> : null}</td>
                <td className="text-right">{nombre(p.contactees)}{p.objectifs?.contacts ? <span className="text-gray-400"> / {p.objectifs.contacts}</span> : null}</td>
                <td className="text-right">{nombre(p.jointes)}</td>
                <td className="text-right">{nombre(p.decideur)}</td>
                <td className="text-right">{nombre(p.qualifiees)}</td>
                <td className="text-right">{nombre(p.rdv)}{p.objectifs?.rdv ? <span className="text-gray-400"> / {p.objectifs.rdv}</span> : null}</td>
                <td className="text-right">{nombre(p.opportunites)}</td>
                <td className="text-right">{nombre(p.clientes)}</td>
                <td className="text-right">{nombre(p.interactions)} ({nombre(p.interactions_7j)})</td>
                <td className="text-right">{fcfa(p.montant_pipeline_fcfa)}</td>
                <td className="text-right">{pct(p.taux_couverture)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
