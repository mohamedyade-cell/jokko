import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Chargement, Erreur, useApi, useToast } from "../components/ui";
import { dateHeureFr } from "../format";

type Cote = Record<string, string | number | boolean | null> & { id: string; introuvable?: boolean };
interface Paire { id: number; niveau: string; criteres: string[]; decision: string | null; id_principal: string | null; justification: string | null; decide_par: string | null; decide_le: string | null; nom_seul: boolean; a: Cote; b: Cote }

const CHAMPS: [string, string][] = [["raison_sociale", "Raison sociale"], ["sigle", "Sigle"], ["ninea", "NINEA"], ["rccm", "RCCM"], ["naema_code", "NAEMA"],
  ["telephone", "Téléphone"], ["telephone2", "Téléphone 2"], ["email", "E-mail"], ["adresse", "Adresse"], ["ville", "Ville"], ["contact_nom", "Contact"],
  ["segment", "Segment"], ["taille", "Taille"], ["score", "Score"], ["commercial", "Commercial"], ["nb_fiches", "Fiches"]];
const NIVEAUX: Record<string, string> = { fort: "bg-sunu text-white", moyen: "bg-red-200 text-red-900", faible: "bg-gray-200 text-gray-700" };

function CartePaire({ p, peutDecider, onDecide }: { p: Paire; peutDecider: boolean; onDecide: () => void }) {
  const notifier = useToast();
  const [principal, setPrincipal] = useState(p.a.id);
  const [justif, setJustif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const decider = (decision: string) =>
    api.post(`/api/doublons/${p.id}/decision`, { decision, id_principal: principal, justification: justif || null })
      .then(() => { notifier(decision); onDecide(); }).catch((e) => setErreur(e.message));
  return (
    <div className="carte">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className={`badge ${NIVEAUX[p.niveau]}`}>{p.niveau}</span>
        {p.criteres.map((c) => <span key={c} className="badge bg-gray-100 text-gray-700">{c}</span>)}
        {p.nom_seul && <span className="text-xs text-sunu">Rapprochement sur le seul nom : vérifiez un identifiant avant toute fusion.</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="tableau">
          <thead><tr><th>Champ</th><th><Link className="btn-lien" to={`/entreprises/${p.a.id}`}>{p.a.id}</Link></th><th><Link className="btn-lien" to={`/entreprises/${p.b.id}`}>{p.b.id}</Link></th></tr></thead>
          <tbody>
            {CHAMPS.map(([k, l]) => {
              const va = p.a[k], vb = p.b[k];
              const egal = va !== null && va !== "" && String(va).toLowerCase() === String(vb ?? "").toLowerCase();
              return <tr key={k}><td className="text-xs text-gray-500">{l}</td><td className={egal ? "bg-yellow-50" : ""}>{String(va ?? "—")}</td><td className={egal ? "bg-yellow-50" : ""}>{String(vb ?? "—")}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
      {p.decision ? (
        <div className="mt-2 text-sm"><b>{p.decision}</b>{p.id_principal && ` (ID conservé : ${p.id_principal})`} — {p.decide_par}, {dateHeureFr(p.decide_le)}{p.justification && ` — ${p.justification}`}</div>
      ) : peutDecider ? (
        <div className="mt-3 space-y-2">
          <Erreur texte={erreur} />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>ID à conserver :</span>
            {[p.a.id, p.b.id].map((id) => <label key={id} className="flex items-center gap-1"><input type="radio" checked={principal === id} onChange={() => setPrincipal(id)} />{id}</label>)}
          </div>
          <input className="champ" placeholder={p.nom_seul ? "Justification obligatoire (identifiant vérifié, appel…)" : "Justification (facultative)"} value={justif} onChange={(e) => setJustif(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-primaire" onClick={() => decider("Doublon confirmé")}>Doublon confirmé</button>
            <button className="btn-secondaire" onClick={() => decider("Entreprises distinctes")}>Entreprises distinctes</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Doublons() {
  const { user } = useAuth();
  const [statut, setStatut] = useState("a_traiter");
  const [niveau, setNiveau] = useState("");
  const { data, erreur, recharger } = useApi<{ total: number; items: Paire[] }>("/api/doublons", { statut, niveau: niveau || undefined, limite: 50 });
  const resp = user.role === "responsable";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="titre">Doublons <span className="text-sm font-normal text-gray-500">({data?.total ?? 0})</span></h1>
        <div className="flex gap-2">
          <select className="champ w-40" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut"><option value="a_traiter">À traiter</option><option value="decides">Décidés</option></select>
          <select className="champ w-36" value={niveau} onChange={(e) => setNiveau(e.target.value)} aria-label="Niveau"><option value="">Tous niveaux</option><option value="fort">Fort</option><option value="moyen">Moyen</option><option value="faible">Faible</option></select>
          {resp && <button className="btn-secondaire" onClick={() => api.post("/api/doublons/detecter").then(recharger)}>Relancer la détection</button>}
        </div>
      </div>
      <p className="text-sm text-gray-600">Une fusion ne supprime rien : l'ID secondaire devient un alias de l'ID conservé et ses saisies y sont rattachées. Jamais de fusion sur le seul nom.</p>
      <Erreur texte={erreur} />
      {!data ? <Chargement /> : data.items.map((p) => <CartePaire key={p.id} p={p} peutDecider={resp} onDecide={recharger} />)}
    </div>
  );
}
