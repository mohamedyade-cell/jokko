import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, ErreurApi } from "../api";

// --- Chargement de données ----------------------------------------------------------

export function useApi<T>(url: string | null, params?: Record<string, unknown>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const cle = JSON.stringify(params ?? {});
  const recharger = useCallback(() => {
    if (!url) return;
    setChargement(true);
    api
      .get<T>(url, params)
      .then((d) => {
        setData(d);
        setErreur(null);
      })
      .catch((e: ErreurApi) => setErreur(e.message))
      .finally(() => setChargement(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, cle, ...deps]);
  useEffect(() => recharger(), [recharger]);
  return { data, erreur, chargement, recharger, setData };
}

// --- Notifications -----------------------------------------------------------------------

type Toast = { id: number; texte: string; type: "ok" | "erreur" };
const ToastCtx = createContext<(texte: string, type?: "ok" | "erreur") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notifier = useCallback((texte: string, type: "ok" | "erreur" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, texte, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={notifier}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-md px-4 py-3 text-sm text-white shadow-lg ${t.type === "ok" ? "bg-gray-800" : "bg-sunu"}`}>
            {t.texte}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// --- Éléments d'interface -------------------------------------------------------------------

const COULEURS_CAT: Record<string, string> = {
  A: "bg-sunu text-white",
  B: "bg-red-200 text-red-900",
  C: "bg-gray-200 text-gray-800",
  D: "bg-gray-100 text-gray-500",
};

export function BadgeCategorie({ c }: { c: string }) {
  return <span className={`badge ${COULEURS_CAT[c] ?? ""}`} title={`Catégorie ${c}`}>{c}</span>;
}

export function Chargement() {
  return <div className="p-6 text-sm text-gray-500">Chargement…</div>;
}

export function Erreur({ texte }: { texte: string | null }) {
  if (!texte) return null;
  return <div className="rounded-md border border-sunu bg-sunu-clair px-4 py-3 text-sm text-sunu-fonce">{texte}</div>;
}

export function Kpi({ libelle, valeur, detail }: { libelle: string; valeur: ReactNode; detail?: ReactNode }) {
  return (
    <div className="carte">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{libelle}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">{valeur}</div>
      {detail && <div className="mt-1 text-xs text-gray-500">{detail}</div>}
    </div>
  );
}

export function Barres({ donnees, max }: { donnees: { libelle: string; valeur: number; secondaire?: number }[]; max?: number }) {
  const m = max ?? Math.max(1, ...donnees.map((d) => d.valeur));
  return (
    <div className="space-y-1.5">
      {donnees.map((d) => (
        <div key={d.libelle} className="flex items-center gap-2 text-sm">
          <div className="w-36 shrink-0 truncate text-gray-600" title={d.libelle}>{d.libelle}</div>
          <div className="relative h-5 flex-1 rounded bg-gray-100">
            <div className="absolute inset-y-0 left-0 rounded bg-sunu" style={{ width: `${(100 * d.valeur) / m}%` }} />
            {d.secondaire !== undefined && (
              <div className="absolute inset-y-0 left-0 rounded bg-sunu-fonce/70" style={{ width: `${(100 * d.secondaire) / m}%` }} />
            )}
          </div>
          <div className="w-20 shrink-0 text-right tabular-nums text-gray-800">
            {d.valeur.toLocaleString("fr-FR")}
            {d.secondaire !== undefined && <span className="text-gray-400"> / {d.secondaire.toLocaleString("fr-FR")}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Colonnes({ donnees, series }: { donnees: Record<string, number | string>[]; series: { cle: string; libelle: string; couleur: string }[] }) {
  const max = Math.max(1, ...donnees.flatMap((d) => series.map((s) => Number(d[s.cle]) || 0)));
  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {donnees.map((d, i) => (
          <div key={i} className="flex h-full flex-1 items-end justify-center gap-0.5" title={String(d.periode)}>
            {series.map((s) => (
              <div key={s.cle} className={`w-full rounded-t ${s.couleur}`} style={{ height: `${(100 * (Number(d[s.cle]) || 0)) / max}%` }}
                title={`${d.periode} — ${s.libelle} : ${d[s.cle]}`} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-gray-500">
        {donnees.map((d, i) => (
          <div key={i} className="flex-1 truncate text-center">{String(d.periode).split(" ")[0]}</div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
        {series.map((s) => (
          <span key={s.cle} className="flex items-center gap-1"><span className={`inline-block h-2 w-3 rounded ${s.couleur}`} />{s.libelle}</span>
        ))}
      </div>
    </div>
  );
}

export function Modal({ titre, ouvert, onFermer, children }: { titre: string; ouvert: boolean; onFermer: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFermer]);
  if (!ouvert) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onFermer}>
      <div role="dialog" aria-modal="true" aria-label={titre} className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:max-w-2xl sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{titre}</h2>
          <button className="text-2xl leading-none text-gray-400 hover:text-gray-700" onClick={onFermer} aria-label="Fermer">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Saisie de date au format jj/mm/aaaa (valeur ISO en interne)
export function ChampDate({ valeur, onChange, id, requis }: { valeur: string | null; onChange: (iso: string | null) => void; id?: string; requis?: boolean }) {
  const versFr = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
  const [texte, setTexte] = useState(versFr(valeur));
  useEffect(() => setTexte(versFr(valeur)), [valeur]);
  const changer = (brut: string) => {
    let t = brut.replace(/[^\d/]/g, "");
    if (/^\d{3}$/.test(t)) t = t.slice(0, 2) + "/" + t.slice(2);
    if (/^\d{2}\/\d{3}$/.test(t)) t = t.slice(0, 5) + "/" + t.slice(5);
    t = t.slice(0, 10);
    setTexte(t);
    const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) {
      const d = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`);
      if (!isNaN(d.getTime()) && d.getDate() === Number(m[1])) onChange(`${m[3]}-${m[2]}-${m[1]}`);
    } else if (t === "") onChange(null);
  };
  return <input id={id} className="champ" inputMode="numeric" placeholder="jj/mm/aaaa" value={texte} required={requis} onChange={(e) => changer(e.target.value)} />;
}

export function Pagination({ page, total, taille, onPage }: { page: number; total: number; taille: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / taille));
  return (
    <div className="flex items-center justify-between gap-2 py-3 text-sm text-gray-600">
      <span>{total.toLocaleString("fr-FR")} résultat(s)</span>
      <div className="flex items-center gap-2">
        <button className="btn-secondaire" disabled={page <= 1} onClick={() => onPage(page - 1)}>Précédent</button>
        <span>Page {page} / {pages}</span>
        <button className="btn-secondaire" disabled={page >= pages} onClick={() => onPage(page + 1)}>Suivant</button>
      </div>
    </div>
  );
}

export function OuiNon({ v }: { v: boolean | null | undefined }) {
  if (v === null || v === undefined) return <span className="text-gray-400">—</span>;
  return v ? <span className="font-medium text-green-700">Oui</span> : <span className="text-gray-500">Non</span>;
}

export function Interrupteur({ libelle, valeur, onChange }: { libelle: string; valeur: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!valeur)} aria-pressed={valeur}
      className={`flex min-h-[48px] items-center justify-center rounded-lg border-2 px-3 text-sm font-semibold transition ${valeur ? "border-sunu bg-sunu text-white" : "border-gray-300 bg-white text-gray-600"}`}>
      {libelle} : {valeur ? "Oui" : "Non"}
    </button>
  );
}
