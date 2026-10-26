import { useState } from "react";
import { Link } from "react-router-dom";
import { api, Opportunite, telecharger } from "../api";
import { useAuth } from "../auth";
import FormOpportunite from "../components/FormOpportunite";
import { Chargement, Erreur, Modal, useApi, useToast } from "../components/ui";
import { dateFr, fcfa, montant } from "../format";

interface Colonne { etape: string; probabilite: number | null; nb: number; montant_fcfa: number; pondere_fcfa: number; pnb_fcfa: number; items: Opportunite[] }
interface Kanban { colonnes: Colonne[]; etapes: { nom: string; probabilite: number }[]; devises: string[] }

export default function Pipeline() {
  const { user } = useAuth();
  const notifier = useToast();
  const [commercial, setCommercial] = useState("");
  const [masquerVides, setMasquerVides] = useState(true);
  const [edition, setEdition] = useState<Opportunite | null>(null);
  const { data, erreur, recharger } = useApi<Kanban>("/api/pipeline/kanban", { commercial_id: commercial || undefined });
  const filtres = useApi<{ commerciaux: { id: number; nom: string; role: string }[] }>("/api/entreprises-filtres");
  const saisie = user.role !== "lecture";

  const deplacer = (id: number, etape: string) =>
    api.post(`/api/opportunites/${id}/etape`, { etape }).then(() => { notifier(`Déplacée vers « ${etape} »`); recharger(); }).catch((e) => notifier(e.message, "erreur"));

  if (erreur) return <Erreur texte={erreur} />;
  if (!data) return <Chargement />;
  const colonnes = masquerVides ? data.colonnes.filter((c) => c.nb > 0) : data.colonnes;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="titre">Pipeline</h1>
        <div className="flex flex-wrap items-center gap-2">
          {user.role !== "fx_sales" && (
            <select className="champ w-52" value={commercial} onChange={(e) => setCommercial(e.target.value)} aria-label="Commercial">
              <option value="">Tous les commerciaux</option>
              {filtres.data?.commerciaux.filter((c) => c.role === "fx_sales").map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          )}
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={masquerVides} onChange={(e) => setMasquerVides(e.target.checked)} /> Masquer les étapes vides</label>
          <button className="btn-secondaire" onClick={() => telecharger("/api/exports/opportunites", { commercial_id: commercial || undefined, format: "xlsx" })}>Excel</button>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {colonnes.map((c) => (
          <div key={c.etape} className="w-72 shrink-0 rounded-lg bg-gray-100 p-2"
            onDragOver={(e) => saisie && e.preventDefault()}
            onDrop={(e) => { const id = Number(e.dataTransfer.getData("text/plain")); if (id && saisie) deplacer(id, c.etape); }}>
            <div className="mb-2 px-1">
              <div className="text-sm font-semibold text-gray-800">{c.etape} <span className="font-normal text-gray-500">({c.nb})</span></div>
              <div className="text-xs text-gray-500">{fcfa(c.montant_fcfa)} · pondéré {fcfa(c.pondere_fcfa)}</div>
            </div>
            <div className="space-y-2">
              {c.items.map((o) => (
                <div key={o.id} draggable={saisie} onDragStart={(e) => e.dataTransfer.setData("text/plain", String(o.id))}
                  className="cursor-grab rounded-md border border-gray-200 bg-white p-2 text-sm shadow-sm">
                  <Link to={`/entreprises/${o.entreprise_id}`} className="font-medium hover:text-sunu">{o.raison_sociale}</Link>
                  <div className="text-xs text-gray-600">{o.intitule ?? o.produit} · {o.produit}</div>
                  <div className="mt-1 flex justify-between text-xs"><span>{montant(o.montant, o.devise)}</span><span>{o.probabilite ?? 0} %</span></div>
                  <div className="text-xs text-gray-500">{fcfa(o.montant_fcfa)} · {o.marge_pb} pb · PNB {fcfa(o.pnb_estime_fcfa)}</div>
                  <div className="text-xs text-gray-500">Clôture : {dateFr(o.date_cloture_prevue) || "—"} · {o.commercial ?? "—"}</div>
                  {saisie && (
                    <div className="mt-1 flex gap-1">
                      <select className="flex-1 rounded border border-gray-200 text-xs" value={o.etape} onChange={(e) => deplacer(o.id, e.target.value)} aria-label="Changer d'étape">
                        {data.etapes.map((x) => <option key={x.nom} value={x.nom}>{x.nom}</option>)}
                      </select>
                      <button className="rounded border border-gray-200 px-2 text-xs" onClick={() => setEdition(o)}>Modifier</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Modal titre="Modifier l'opportunité" ouvert={!!edition} onFermer={() => setEdition(null)}>
        {edition && <FormOpportunite entrepriseId={edition.entreprise_id} existante={edition} etapes={data.etapes} devises={data.devises} onEnregistre={() => { setEdition(null); recharger(); }} />}
      </Modal>
    </div>
  );
}
