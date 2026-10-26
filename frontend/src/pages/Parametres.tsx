import { FormEvent, useState } from "react";
import { api, ErreurApi } from "../api";
import { ChampDate, Chargement, Erreur, Modal, useApi, useToast } from "../components/ui";
import { ROLES } from "../format";

interface Segment { nom: string; import_pts: number; export_pts: number; intensite_pts: number; frequence_pts: number; couverture_pts: number; potentiel_pts: number; vague_defaut: number | null; accroche: string | null }
interface Taille { nom: string; ordre: number; intensite_pts: number; frequence_pts: number; potentiel_pts: number }
interface Params { valeurs: Record<string, unknown>; descriptions: Record<string, string>; segments: Segment[]; tailles: Taille[] }
interface U { id: number; login: string; nom: string; email: string | null; role: string; actif: boolean; alias_classeur: string | null; entra_lie: boolean }

const SCALAIRES: [string, string][] = [["seuil_A", "number"], ["seuil_B", "number"], ["seuil_C", "number"], ["objectif_couverture_pct", "number"],
  ["objectif_duree_mois", "number"], ["date_lancement", "date"], ["marge_pb_defaut", "number"], ["echantillon_taille", "number"]];

export default function Parametres() {
  const notifier = useToast();
  const { data, erreur, recharger } = useApi<Params>("/api/parametres");
  const users = useApi<U[]>("/api/utilisateurs");
  const [edition, setEdition] = useState<Record<string, string>>({});
  const [segment, setSegment] = useState<Segment | null>(null);
  const [taille, setTaille] = useState<Taille | null>(null);
  const [user, setUser] = useState<(Partial<U> & { mot_de_passe?: string }) | null>(null);
  const [erreurU, setErreurU] = useState<string | null>(null);

  if (erreur) return <Erreur texte={erreur} />;
  if (!data) return <Chargement />;
  const v = data.valeurs;

  const enregistrer = (cle: string, valeur: unknown) =>
    api.put<{ recalculees: number }>(`/api/parametres/${cle}`, { valeur })
      .then((r) => { notifier(`Enregistré — ${r.recalculees} entreprise(s) recalculée(s)`); setEdition((e) => { const n = { ...e }; delete n[cle]; return n; }); recharger(); })
      .catch((e: ErreurApi) => notifier(e.message, "erreur"));
  const envoyerSegment = (e: FormEvent) => {
    e.preventDefault();
    if (!segment) return;
    const { nom, ...corps } = segment;
    api.put(`/api/segments/${encodeURIComponent(nom)}`, corps).then(() => { notifier("Segment enregistré, base recalculée"); setSegment(null); recharger(); }).catch((x) => notifier(x.message, "erreur"));
  };
  const envoyerTaille = (e: FormEvent) => {
    e.preventDefault();
    if (!taille) return;
    const { nom, ...corps } = taille;
    api.put(`/api/tailles/${encodeURIComponent(nom)}`, corps).then(() => { notifier("Taille enregistrée, base recalculée"); setTaille(null); recharger(); }).catch((x) => notifier(x.message, "erreur"));
  };
  const envoyerUser = (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const corps = { login: user.login, nom: user.nom, email: user.email || null, role: user.role, actif: user.actif ?? true, alias_classeur: user.alias_classeur || null, mot_de_passe: user.mot_de_passe || null };
    (user.id ? api.put(`/api/utilisateurs/${user.id}`, corps) : api.post("/api/utilisateurs", corps))
      .then(() => { notifier("Utilisateur enregistré"); setUser(null); users.recharger(); }).catch((x: ErreurApi) => setErreurU(x.message));
  };
  const num = (s: string) => Number(s.replace(",", "."));

  return (
    <div className="space-y-6">
      <h1 className="titre">Paramètres <span className="text-sm font-normal text-gray-500">— toute modification recalcule immédiatement scores, catégories et vagues</span></h1>

      <div className="carte">
        <h2 className="mb-3 font-semibold">Seuils et objectifs</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {SCALAIRES.map(([cle, type]) => (
            <div key={cle} className="flex items-end gap-2">
              <div className="flex-1">
                <label className="etiquette" htmlFor={cle}>{data.descriptions[cle] ?? cle}</label>
                {type === "date"
                  ? <ChampDate id={cle} valeur={edition[cle] ?? (v[cle] as string | null)} onChange={(d) => setEdition({ ...edition, [cle]: d ?? "" })} />
                  : <input id={cle} className="champ" inputMode="decimal" value={edition[cle] ?? String(v[cle] ?? "")} onChange={(e) => setEdition({ ...edition, [cle]: e.target.value })} />}
              </div>
              {edition[cle] !== undefined && <button className="btn-primaire" onClick={() => enregistrer(cle, type === "number" ? num(edition[cle]) : edition[cle] || null)}>OK</button>}
            </div>
          ))}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="etiquette" htmlFor="vl">Vagues lancées (ex. 1, 2)</label>
              <input id="vl" className="champ" value={edition.vagues_lancees ?? (v.vagues_lancees as number[]).join(", ")} onChange={(e) => setEdition({ ...edition, vagues_lancees: e.target.value })} />
            </div>
            {edition.vagues_lancees !== undefined && <button className="btn-primaire" onClick={() => enregistrer("vagues_lancees", edition.vagues_lancees.split(/[,; ]+/).filter(Boolean).map(Number))}>OK</button>}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(v.vague_grande_taille_active)} onChange={(e) => enregistrer("vague_grande_taille_active", e.target.checked)} /> {data.descriptions.vague_grande_taille_active}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(v.fx_sales_voit_toute_base)} onChange={(e) => enregistrer("fx_sales_voit_toute_base", e.target.checked)} /> {data.descriptions.fx_sales_voit_toute_base}</label>
        </div>
      </div>

      <div className="carte overflow-x-auto">
        <h2 className="mb-3 font-semibold">Segments (points d'hypothèse, vague par défaut, accroche)</h2>
        <table className="tableau">
          <thead><tr><th>Segment</th><th>Import /20</th><th>Export /20</th><th>Intensité /15</th><th>Fréquence /15</th><th>Couverture /10</th><th>Potentiel /10</th><th>Vague</th><th>Accroche</th><th /></tr></thead>
          <tbody>{data.segments.map((s) => (
            <tr key={s.nom}><td className="font-medium">{s.nom}</td><td>{s.import_pts}</td><td>{s.export_pts}</td><td>{s.intensite_pts}</td><td>{s.frequence_pts}</td><td>{s.couverture_pts}</td><td>{s.potentiel_pts}</td><td>{s.vague_defaut}</td><td className="max-w-xs truncate text-xs">{s.accroche}</td><td><button className="btn-lien text-sm" onClick={() => setSegment(s)}>Modifier</button></td></tr>
          ))}</tbody>
        </table>
        <button className="btn-secondaire mt-2" onClick={() => setSegment({ nom: "", import_pts: 0, export_pts: 0, intensite_pts: 0, frequence_pts: 0, couverture_pts: 0, potentiel_pts: 0, vague_defaut: 3, accroche: "" })}>+ Segment</button>
      </div>

      <div className="carte overflow-x-auto">
        <h2 className="mb-3 font-semibold">Tailles</h2>
        <table className="tableau">
          <thead><tr><th>Taille</th><th>Ordre</th><th>Intensité /15</th><th>Fréquence /15</th><th>Potentiel /10</th><th /></tr></thead>
          <tbody>{data.tailles.map((t) => <tr key={t.nom}><td className="font-medium">{t.nom}</td><td>{t.ordre}</td><td>{t.intensite_pts}</td><td>{t.frequence_pts}</td><td>{t.potentiel_pts}</td><td><button className="btn-lien text-sm" onClick={() => setTaille(t)}>Modifier</button></td></tr>)}</tbody>
        </table>
      </div>

      <div className="carte">
        <h2 className="mb-3 font-semibold">Étapes du pipeline et taux de change</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="etiquette" htmlFor="etp">Étapes (une par ligne : nom ; probabilité)</label>
            <textarea id="etp" rows={14} className="champ font-mono text-xs"
              value={edition.etapes_pipeline ?? (v.etapes_pipeline as { nom: string; probabilite: number }[]).map((e) => `${e.nom} ; ${e.probabilite}`).join("\n")}
              onChange={(e) => setEdition({ ...edition, etapes_pipeline: e.target.value })} />
            {edition.etapes_pipeline !== undefined && <button className="btn-primaire mt-2" onClick={() => {
              const anciennes = v.etapes_pipeline as Record<string, unknown>[];
              enregistrer("etapes_pipeline", edition.etapes_pipeline.split("\n").filter((l) => l.trim()).map((l) => {
                const [nom, p] = l.split(";").map((x) => x.trim());
                const prev = anciennes.find((a) => a.nom === nom) ?? {};
                return { ...prev, nom, probabilite: Number(p) || 0 };
              }));
            }}>Enregistrer les étapes</button>}
          </div>
          <div>
            <label className="etiquette" htmlFor="tx">Taux de conversion en FCFA (devise ; taux)</label>
            <textarea id="tx" rows={8} className="champ font-mono text-xs"
              value={edition.taux_change ?? Object.entries(v.taux_change as Record<string, number>).map(([d, t]) => `${d} ; ${t}`).join("\n")}
              onChange={(e) => setEdition({ ...edition, taux_change: e.target.value })} />
            {edition.taux_change !== undefined && <button className="btn-primaire mt-2" onClick={() => enregistrer("taux_change", Object.fromEntries(edition.taux_change.split("\n").filter((l) => l.includes(";")).map((l) => { const [d, t] = l.split(";").map((x) => x.trim()); return [d.toUpperCase(), num(t)]; })))}>Enregistrer les taux</button>}
            <p className="mt-2 text-xs text-gray-500">Taux indicatifs servant uniquement à agréger le pipeline en FCFA (EUR/XOF fixe : 655,957).</p>
          </div>
        </div>
      </div>

      <div className="carte overflow-x-auto">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Utilisateurs</h2><button className="btn-secondaire" onClick={() => { setErreurU(null); setUser({ role: "fx_sales", actif: true }); }}>+ Utilisateur</button></div>
        <table className="tableau">
          <thead><tr><th>Identifiant</th><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Alias classeur</th><th>Actif</th><th>M365</th><th /></tr></thead>
          <tbody>{users.data?.map((u) => <tr key={u.id}><td>{u.login}</td><td>{u.nom}</td><td>{u.email}</td><td>{ROLES[u.role]}</td><td>{u.alias_classeur}</td><td>{u.actif ? "Oui" : "Non"}</td><td>{u.entra_lie ? "lié" : ""}</td><td><button className="btn-lien text-sm" onClick={() => { setErreurU(null); setUser(u); }}>Modifier</button></td></tr>)}</tbody>
        </table>
      </div>

      <Modal titre={segment?.nom ? `Segment : ${segment.nom}` : "Nouveau segment"} ouvert={!!segment} onFermer={() => setSegment(null)}>
        {segment && (
          <form onSubmit={envoyerSegment} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="etiquette" htmlFor="sn">Nom</label><input id="sn" className="champ" value={segment.nom} onChange={(e) => setSegment({ ...segment, nom: e.target.value })} required /></div>
            {(["import_pts", "export_pts", "intensite_pts", "frequence_pts", "couverture_pts", "potentiel_pts", "vague_defaut"] as const).map((k) => (
              <div key={k}><label className="etiquette" htmlFor={k}>{k.replace("_pts", "").replace("_", " ")}</label><input id={k} className="champ" inputMode="decimal" value={segment[k] ?? ""} onChange={(e) => setSegment({ ...segment, [k]: e.target.value === "" ? null : num(e.target.value) })} /></div>
            ))}
            <div className="sm:col-span-2"><label className="etiquette" htmlFor="acc">Accroche commerciale</label><textarea id="acc" className="champ" rows={3} value={segment.accroche ?? ""} onChange={(e) => setSegment({ ...segment, accroche: e.target.value })} /></div>
            <button className="btn-primaire sm:col-span-2">Enregistrer</button>
          </form>
        )}
      </Modal>
      <Modal titre={`Taille : ${taille?.nom ?? ""}`} ouvert={!!taille} onFermer={() => setTaille(null)}>
        {taille && (
          <form onSubmit={envoyerTaille} className="grid gap-3 sm:grid-cols-2">
            {(["ordre", "intensite_pts", "frequence_pts", "potentiel_pts"] as const).map((k) => (
              <div key={k}><label className="etiquette" htmlFor={`t-${k}`}>{k.replace("_pts", "")}</label><input id={`t-${k}`} className="champ" inputMode="decimal" value={taille[k]} onChange={(e) => setTaille({ ...taille, [k]: num(e.target.value) || 0 })} /></div>
            ))}
            <button className="btn-primaire sm:col-span-2">Enregistrer</button>
          </form>
        )}
      </Modal>
      <Modal titre={user?.id ? `Utilisateur : ${user.login}` : "Nouvel utilisateur"} ouvert={!!user} onFermer={() => setUser(null)}>
        {user && (
          <form onSubmit={envoyerUser} className="grid gap-3 sm:grid-cols-2">
            <Erreur texte={erreurU} />
            <div><label className="etiquette" htmlFor="ul">Identifiant</label><input id="ul" className="champ" value={user.login ?? ""} disabled={!!user.id} onChange={(e) => setUser({ ...user, login: e.target.value })} required /></div>
            <div><label className="etiquette" htmlFor="un">Nom</label><input id="un" className="champ" value={user.nom ?? ""} onChange={(e) => setUser({ ...user, nom: e.target.value })} required /></div>
            <div><label className="etiquette" htmlFor="ue">E-mail professionnel (Microsoft 365)</label><input id="ue" type="email" className="champ" value={user.email ?? ""} onChange={(e) => setUser({ ...user, email: e.target.value })} /></div>
            <div><label className="etiquette" htmlFor="ur">Rôle</label><select id="ur" className="champ" value={user.role} onChange={(e) => setUser({ ...user, role: e.target.value })}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="etiquette" htmlFor="ua">Nom dans le classeur (alias)</label><input id="ua" className="champ" value={user.alias_classeur ?? ""} onChange={(e) => setUser({ ...user, alias_classeur: e.target.value })} placeholder="séparés par ;" /></div>
            <div><label className="etiquette" htmlFor="up">{user.id ? "Nouveau mot de passe (facultatif)" : "Mot de passe (12 caractères min.)"}</label><input id="up" type="password" autoComplete="new-password" className="champ" value={user.mot_de_passe ?? ""} onChange={(e) => setUser({ ...user, mot_de_passe: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={user.actif ?? true} onChange={(e) => setUser({ ...user, actif: e.target.checked })} /> Compte actif</label>
            <button className="btn-primaire sm:col-span-2">Enregistrer</button>
          </form>
        )}
      </Modal>
    </div>
  );
}
