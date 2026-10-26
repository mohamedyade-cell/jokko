import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, EntrepriseItem, Interaction, Page } from "../api";
import FormInteraction from "../components/FormInteraction";
import { BadgeCategorie, useApi } from "../components/ui";
import { dateFr } from "../format";

// Saisie rapide, pensée pour le téléphone : choisir l'entreprise, toucher, enregistrer.
export default function CallTracker() {
  const [q, setQ] = useState("");
  const [resultats, setResultats] = useState<EntrepriseItem[]>([]);
  const [choix, setChoix] = useState<EntrepriseItem | null>(null);
  const [cle, setCle] = useState(0);
  const agenda = useApi<{ en_retard: Interaction[]; aujourdhui: Interaction[] }>("/api/agenda", { jours: 0 }, [cle]);
  const recentes = useApi<Interaction[]>("/api/interactions", { limite: 10 }, [cle]);

  useEffect(() => {
    if (q.trim().length < 2) { setResultats([]); return; }
    const t = setTimeout(() => api.get<Page<EntrepriseItem>>("/api/entreprises", { q, taille_page: 8 }).then((r) => setResultats(r.items)), 250);
    return () => clearTimeout(t);
  }, [q]);

  const choisirParId = (id: string) => api.get<EntrepriseItem>(`/api/entreprises/${id}`).then((e) => { setChoix(e); window.scrollTo(0, 0); });
  const aRelancer = [...(agenda.data?.en_retard ?? []), ...(agenda.data?.aujourdhui ?? [])];

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="titre">Call Tracker</h1>
      {!choix ? (
        <>
          <div className="carte space-y-2">
            <input className="champ min-h-[48px] text-base" placeholder="Entreprise : nom, téléphone, NINEA…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Rechercher une entreprise" />
            <ul className="divide-y divide-gray-100">
              {resultats.map((e) => (
                <li key={e.id}>
                  <button className="flex min-h-[52px] w-full items-center justify-between gap-2 px-1 text-left" onClick={() => setChoix(e)}>
                    <span><span className="font-medium">{e.raison_sociale}</span><br /><span className="text-xs text-gray-500">{e.id} · {e.telephone ?? "pas de téléphone"}</span></span>
                    <BadgeCategorie c={e.categorie} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {aRelancer.length > 0 && (
            <div className="carte">
              <h2 className="mb-2 font-semibold">À relancer aujourd'hui ({aRelancer.length})</h2>
              <ul className="divide-y divide-gray-100">
                {aRelancer.slice(0, 15).map((i) => (
                  <li key={i.id}>
                    <button className="flex min-h-[52px] w-full items-center justify-between text-left" onClick={() => choisirParId(i.entreprise_id)}>
                      <span><span className="font-medium">{i.raison_sociale}</span><br /><span className="text-xs text-gray-500">{i.prochaine_action} · prévu le {dateFr(i.date_prochaine_action)}</span></span>
                      <span className="text-sunu">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="carte space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <Link to={`/entreprises/${choix.id}`} className="text-lg font-semibold hover:text-sunu">{choix.raison_sociale}</Link>
              <div className="text-xs text-gray-500">{choix.id} · score {choix.score} · catégorie {choix.categorie}</div>
            </div>
            <button className="btn-secondaire" onClick={() => setChoix(null)}>Changer</button>
          </div>
          {choix.telephone && (
            <a className="btn-primaire min-h-[48px] w-full text-base" href={`tel:${choix.telephone.replace(/\s/g, "")}`}>Appeler {choix.telephone}</a>
          )}
          <FormInteraction key={choix.id + cle} entrepriseId={choix.id} onEnregistre={() => { setChoix(null); setQ(""); setCle(cle + 1); }} />
        </div>
      )}
      <div className="carte">
        <h2 className="mb-2 font-semibold">Mes dernières saisies</h2>
        <ul className="space-y-1 text-sm">
          {recentes.data?.map((i) => (
            <li key={i.id} className="flex justify-between gap-2"><span className="truncate">{dateFr(i.date)} · {i.raison_sociale}</span><span className="shrink-0 text-gray-500">{i.type}{i.joint ? " · joint" : ""}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
