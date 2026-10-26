import { FormEvent, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { api, ErreurApi, Interaction, Opportunite } from "../api";
import { estResponsable, useAuth } from "../auth";
import FormInteraction from "../components/FormInteraction";
import FormOpportunite from "../components/FormOpportunite";
import FormQualification, { Qualif } from "../components/FormQualification";
import { BadgeCategorie, Chargement, Erreur, Modal, OuiNon, useApi, useToast } from "../components/ui";
import { dateFr, dateHeureFr, montant, fcfa } from "../format";

interface Source { fichier: string | null; page: number | null; exacte?: boolean; url_page: string | null; url_pdf: string | null }
interface FicheData {
  redirection?: string;
  id: string; raison_sociale: string; sigle: string | null; score: number; categorie: string; vague: number | null; vague_regle: string | null;
  vague_manuelle: number | null; segment: string | null; taille: string | null; commercial: string | null; commercial_id: number | null;
  statut: string; fusionnee_vers: string | null; statut_validation: string; est_cliente: boolean; fictif: boolean; telephone: string | null;
  identite: { champ: string; libelle: string; valeur: string | number | null; source: Source | null; corrige: boolean }[];
  score_detail: { cle: string; critere: string; points: number; max: number; origine: string; detail: string }[];
  seuils: { A: number; B: number; C: number };
  accroche: string | null;
  interactions: Interaction[];
  qualification: Qualif | null;
  opportunites: Opportunite[];
  prochaine_action: Interaction | null;
  corrections: { id: number; champ: string; avant: string | null; apres: string | null; auteur: string; date: string; motif: string | null; origine: string }[];
  anciens_ids: string[];
  fiches_sources: ({ fiche_id: number } & Source)[];
  peut_modifier: boolean;
  absente_dernier_import: boolean;
}

const COULEUR_ORIGINE: Record<string, string> = { "confirmé": "bg-green-100 text-green-800", base: "bg-blue-50 text-blue-800", segment: "bg-gray-100 text-gray-700", taille: "bg-gray-100 text-gray-700" };

function LienSource({ s }: { s: Source | null }) {
  if (!s || !s.fichier) return <span className="text-xs text-gray-400">source inconnue</span>;
  return (
    <span className="text-xs text-gray-500">
      <a className="btn-lien" href={s.url_pdf ?? "#"} target="_blank" rel="noopener">{s.fichier} p. {s.page}</a>
      {s.url_page && <> · <a className="btn-lien" href={s.url_page} target="_blank" rel="noopener">image</a></>}
      {s.exacte === false && <span title="Valeur non retrouvée telle quelle dans la fiche : page de rattachement de l'entreprise"> (approx.)</span>}
    </span>
  );
}

export default function Fiche() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const notifier = useToast();
  const { data, erreur, recharger } = useApi<FicheData>(`/api/entreprises/${id}`, undefined, [id]);
  const etapes = useApi<{ etapes: { nom: string; probabilite: number }[]; devises: string[] }>("/api/pipeline/kanban");
  const filtres = useApi<{ commerciaux: { id: number; nom: string; role: string }[] }>(estResponsable(user) ? "/api/entreprises-filtres" : null);
  const [onglet, setOnglet] = useState<"activite" | "qualification" | "pipeline" | "corrections" | "sources">("activite");
  const [modal, setModal] = useState<null | "interaction" | "opportunite" | { champ: string; libelle: string; valeur: string }>(null);
  const [correction, setCorrection] = useState({ valeur: "", motif: "" });
  const [erreurCorr, setErreurCorr] = useState<string | null>(null);

  if (erreur) return <Erreur texte={erreur} />;
  if (!data) return <Chargement />;
  if (data.redirection) return <Navigate to={`/entreprises/${data.redirection}`} replace />;
  const modifiable = data.peut_modifier && data.statut === "Active";
  const fermer = () => setModal(null);
  const apres = () => { fermer(); recharger(); };

  const envoyerCorrection = (e: FormEvent) => {
    e.preventDefault();
    if (!modal || typeof modal === "string") return;
    api.post(`/api/entreprises/${data.id}/corrections`, { champ: modal.champ, valeur: correction.valeur || null, motif: correction.motif || null })
      .then(() => { notifier("Correction enregistrée et tracée"); apres(); })
      .catch((x: ErreurApi) => setErreurCorr(x.message));
  };
  const piloter = (corps: Record<string, unknown>) =>
    api.patch(`/api/entreprises/${data.id}`, corps).then(() => { notifier("Mis à jour"); recharger(); }).catch((x: ErreurApi) => notifier(x.message, "erreur"));

  return (
    <div className="space-y-4">
      {data.statut !== "Active" && (
        <Erreur texte={`Entreprise fusionnée dans ${data.fusionnee_vers} : consultez et saisissez sur l'ID principal.`} />
      )}
      {data.absente_dernier_import && <div className="rounded-md bg-yellow-50 px-4 py-2 text-sm text-yellow-800">Absente de la dernière version du classeur : conservée, à vérifier.</div>}
      <div className="carte">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-xs text-gray-500">{data.id}{data.anciens_ids.length > 0 && ` · anciens ID : ${data.anciens_ids.join(", ")}`}</div>
            <h1 className="text-2xl font-bold text-gray-900">{data.raison_sociale} {data.sigle && <span className="text-lg font-normal text-gray-500">({data.sigle})</span>}</h1>
            <div className="mt-1 flex flex-wrap gap-2 text-sm text-gray-600">
              <span>{data.segment ?? "Segment non renseigné"}</span>·<span>{data.taille ?? "Taille ?"}</span>·
              <span>{data.commercial ? `Commercial : ${data.commercial}` : "Non attribuée"}</span>
              {data.est_cliente && <span className="badge bg-green-100 text-green-800">Cliente</span>}
              <span className={`badge ${data.statut_validation === "Validée" ? "bg-green-50 text-green-700" : "bg-yellow-100 text-yellow-800"}`}>{data.statut_validation}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-center"><div className="text-4xl font-bold text-sunu">{data.score}</div><div className="text-xs text-gray-500">/ 100</div></div>
            <div className="text-center"><div className="scale-150"><BadgeCategorie c={data.categorie} /></div><div className="mt-2 text-xs text-gray-500">catégorie</div></div>
            <div className="text-center"><div className="text-3xl font-bold">{data.vague ?? "—"}</div><div className="text-xs text-gray-500" title={data.vague_regle ?? ""}>vague</div></div>
          </div>
        </div>
        {modifiable && (
          <div className="mt-4 flex flex-wrap gap-2">
            {data.telephone && <a className="btn-secondaire" href={`tel:${data.telephone.replace(/\s/g, "")}`}>Appeler</a>}
            <button className="btn-primaire" onClick={() => setModal("interaction")}>+ Interaction</button>
            <button className="btn-secondaire" onClick={() => setModal("opportunite")}>+ Opportunité</button>
            {data.statut_validation !== "Validée" && <button className="btn-secondaire" onClick={() => api.post(`/api/qualite/${data.id}/valider`, {}).then(recharger)}>Valider la fiche</button>}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="carte">
            <h2 className="mb-3 font-semibold">Identité et contacts <span className="text-xs font-normal text-gray-500">— chaque valeur indique sa source PDF</span></h2>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {data.identite.filter((c) => c.valeur !== null && c.valeur !== "" || modifiable).map((c) => (
                <div key={c.champ} className="border-b border-gray-100 pb-1">
                  <dt className="flex items-center justify-between text-xs font-semibold uppercase text-gray-500">
                    <span>{c.libelle} {c.corrige && <span className="badge bg-blue-50 normal-case text-blue-700" title="Valeur corrigée : protégée contre l'écrasement par un import">corrigé</span>}</span>
                    {modifiable && <button className="text-xs font-normal normal-case text-sunu hover:underline" onClick={() => { setCorrection({ valeur: c.valeur === null ? "" : String(c.valeur), motif: "" }); setErreurCorr(null); setModal({ champ: c.champ, libelle: c.libelle, valeur: String(c.valeur ?? "") }); }}>corriger</button>}
                  </dt>
                  <dd className="text-sm text-gray-900">{c.valeur ?? <span className="text-gray-400">—</span>}</dd>
                  {c.valeur !== null && c.valeur !== "" && <LienSource s={c.source} />}
                </div>
              ))}
            </dl>
          </div>

          <div className="carte">
            <div className="mb-3 flex flex-wrap gap-1 border-b border-gray-200">
              {([["activite", `Historique (${data.interactions.length})`], ["qualification", "Qualification FX"], ["pipeline", `Opportunités (${data.opportunites.length})`],
                ["corrections", `Corrections (${data.corrections.length})`], ["sources", `Fiches PDF (${data.fiches_sources.length})`]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setOnglet(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${onglet === k ? "border-sunu font-semibold text-sunu" : "border-transparent text-gray-600"}`}>{l}</button>
              ))}
            </div>
            {onglet === "activite" && (
              <ul className="space-y-3">
                {data.interactions.length === 0 && <li className="text-sm text-gray-500">Aucune interaction.</li>}
                {data.interactions.map((i) => (
                  <li key={i.id} className="border-l-4 border-sunu/60 pl-3 text-sm">
                    <div className="font-medium">{dateFr(i.date)} · {i.type} · tentative {i.tentative} <span className="font-normal text-gray-500">— {i.commercial ?? "?"}</span></div>
                    <div className="text-gray-600">Joint : <OuiNon v={i.joint} /> · Décideur : <OuiNon v={i.decideur_joint} /> · RDV : <OuiNon v={i.rdv_obtenu} />{i.date_rdv && ` le ${dateFr(i.date_rdv)}`}{i.resultat && ` · ${i.resultat}`}</div>
                    {i.commentaire && <div className="text-gray-700">{i.commentaire}</div>}
                    {i.prochaine_action && <div className="text-xs text-gray-500">→ {i.prochaine_action} le {dateFr(i.date_prochaine_action)} {i.action_faite && "(fait)"}</div>}
                  </li>
                ))}
              </ul>
            )}
            {onglet === "qualification" && (
              <FormQualification entrepriseId={data.id} initial={data.qualification} lectureSeule={!modifiable} onEnregistre={recharger} />
            )}
            {onglet === "pipeline" && (
              <table className="tableau">
                <thead><tr><th>Opportunité</th><th>Étape</th><th className="text-right">Montant</th><th className="text-right">FCFA</th><th className="text-right">Marge</th><th className="text-right">PNB estimé</th><th>Clôture</th></tr></thead>
                <tbody>{data.opportunites.map((o) => (
                  <tr key={o.id}><td>{o.intitule ?? o.produit}</td><td>{o.etape}</td><td className="text-right">{montant(o.montant, o.devise)}</td><td className="text-right">{fcfa(o.montant_fcfa)}</td><td className="text-right">{o.marge_pb} pb</td><td className="text-right">{fcfa(o.pnb_estime_fcfa)}</td><td>{dateFr(o.date_cloture_prevue)}</td></tr>
                ))}</tbody>
              </table>
            )}
            {onglet === "corrections" && (
              <table className="tableau">
                <thead><tr><th>Date</th><th>Champ</th><th>Avant</th><th>Après</th><th>Auteur</th><th>Motif</th></tr></thead>
                <tbody>{data.corrections.map((c) => (
                  <tr key={c.id}><td className="whitespace-nowrap">{dateHeureFr(c.date)}</td><td>{c.champ}</td><td className="text-gray-500 line-through">{c.avant}</td><td>{c.apres}</td><td>{c.auteur}</td><td>{c.motif}</td></tr>
                ))}</tbody>
              </table>
            )}
            {onglet === "sources" && (
              <ul className="space-y-1 text-sm">{data.fiches_sources.map((f) => <li key={f.fiche_id}>Fiche {f.fiche_id} — <LienSource s={f} /></li>)}</ul>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="carte">
            <h2 className="mb-2 font-semibold">Prochaine action</h2>
            {data.prochaine_action ? (
              <div className="text-sm"><div className="font-medium">{data.prochaine_action.prochaine_action}</div><div className="text-gray-500">le {dateFr(data.prochaine_action.date_prochaine_action)}</div></div>
            ) : <div className="text-sm text-gray-500">Aucune relance planifiée.</div>}
          </div>
          {data.accroche && (
            <div className="carte border-l-4 border-l-sunu">
              <h2 className="mb-1 font-semibold">Accroche commerciale</h2>
              <p className="text-sm italic text-gray-700">« {data.accroche} »</p>
            </div>
          )}
          <div className="carte">
            <h2 className="mb-2 font-semibold">Score détaillé</h2>
            <ul className="space-y-2">
              {data.score_detail.map((s) => (
                <li key={s.cle} className="text-sm">
                  <div className="flex justify-between"><span>{s.critere}</span><span className="font-semibold tabular-nums">{s.points} / {s.max}</span></div>
                  <div className="h-1.5 rounded bg-gray-100"><div className="h-1.5 rounded bg-sunu" style={{ width: `${(100 * s.points) / s.max}%` }} /></div>
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-500"><span className={`badge ${COULEUR_ORIGINE[s.origine] ?? ""}`}>{s.origine}</span>{s.detail}</div>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-xs text-gray-500">Seuils : A ≥ {data.seuils.A} · B ≥ {data.seuils.B} · C ≥ {data.seuils.C} · Vague : {data.vague_regle}</div>
          </div>
          {estResponsable(user) && data.statut === "Active" && (
            <div className="carte space-y-3">
              <h2 className="font-semibold">Pilotage (Responsable)</h2>
              <div>
                <label className="etiquette" htmlFor="com">Commercial</label>
                <select id="com" className="champ" value={data.commercial_id ?? ""} onChange={(e) => piloter({ commercial_id: e.target.value ? Number(e.target.value) : null, champs: ["commercial_id"] })}>
                  <option value="">Non attribuée</option>
                  {filtres.data?.commerciaux.filter((c) => c.role !== "lecture").map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="etiquette" htmlFor="vm">Vague manuelle (prioritaire)</label>
                <select id="vm" className="champ" value={data.vague_manuelle ?? ""} onChange={(e) => piloter({ vague_manuelle: e.target.value ? Number(e.target.value) : null, champs: ["vague_manuelle"] })}>
                  <option value="">Automatique</option>
                  {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>Vague {v}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal titre="Nouvelle interaction" ouvert={modal === "interaction"} onFermer={fermer}>
        <FormInteraction entrepriseId={data.id} tentativeSuivante={data.interactions.length + 1} onEnregistre={apres} />
      </Modal>
      <Modal titre="Nouvelle opportunité" ouvert={modal === "opportunite"} onFermer={fermer}>
        {etapes.data && <FormOpportunite entrepriseId={data.id} etapes={etapes.data.etapes} devises={etapes.data.devises} onEnregistre={apres} />}
      </Modal>
      <Modal titre={`Corriger : ${modal && typeof modal === "object" ? modal.libelle : ""}`} ouvert={!!modal && typeof modal === "object"} onFermer={fermer}>
        <form onSubmit={envoyerCorrection} className="space-y-3">
          <Erreur texte={erreurCorr} />
          <div className="text-sm text-gray-600">Valeur actuelle : <b>{modal && typeof modal === "object" ? modal.valeur || "—" : ""}</b></div>
          <div><label className="etiquette" htmlFor="cv">Nouvelle valeur</label><input id="cv" className="champ" value={correction.valeur} onChange={(e) => setCorrection({ ...correction, valeur: e.target.value })} /></div>
          <div><label className="etiquette" htmlFor="cm">Motif</label><input id="cm" className="champ" value={correction.motif} onChange={(e) => setCorrection({ ...correction, motif: e.target.value })} placeholder="ex. vérifié par appel" /></div>
          <p className="text-xs text-gray-500">La correction est tracée (avant, après, auteur, date) et ne sera jamais écrasée par un import.</p>
          <button className="btn-primaire">Enregistrer la correction</button>
        </form>
      </Modal>
      <div className="text-xs text-gray-400"><Link to="/base" className="hover:underline">← Retour à la base</Link></div>
    </div>
  );
}
