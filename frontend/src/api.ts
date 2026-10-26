// Client HTTP : cookie de session httpOnly + en-tête anti-CSRF X-Radar.
export class ErreurApi extends Error {
  constructor(public statut: number, message: string) {
    super(message);
  }
}

async function requete<T>(methode: string, url: string, corps?: unknown): Promise<T> {
  const init: RequestInit = { method: methode, credentials: "same-origin", headers: { "X-Radar": "1" } };
  if (corps instanceof FormData) {
    init.body = corps;
  } else if (corps !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(corps);
  }
  const r = await fetch(url, init);
  if (r.status === 401 && !url.includes("/auth/")) {
    window.dispatchEvent(new Event("radar:deconnexion"));
  }
  if (!r.ok) {
    let message = `Erreur ${r.status}`;
    try {
      const j = await r.json();
      message = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: { msg: string }) => d.msg).join(" ; ") : message;
    } catch {
      /* corps non JSON */
    }
    throw new ErreurApi(r.status, message);
  }
  return (await r.json()) as T;
}

export const api = {
  get: <T,>(url: string, params?: Record<string, unknown>) => requete<T>("GET", url + qs(params)),
  post: <T,>(url: string, corps?: unknown) => requete<T>("POST", url, corps ?? {}),
  put: <T,>(url: string, corps?: unknown) => requete<T>("PUT", url, corps ?? {}),
  patch: <T,>(url: string, corps?: unknown) => requete<T>("PATCH", url, corps ?? {}),
  del: <T,>(url: string) => requete<T>("DELETE", url),
};

export function qs(params?: Record<string, unknown>): string {
  if (!params) return "";
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function telecharger(url: string, params?: Record<string, unknown>) {
  window.location.href = url + qs(params);
}

export interface Utilisateur {
  id: number;
  login: string;
  nom: string;
  email: string | null;
  role: "fx_sales" | "responsable" | "lecture";
  fx_sales_voit_toute_base: boolean;
  jeu_fictif: boolean;
}

export interface EntrepriseItem {
  id: string;
  raison_sociale: string;
  sigle: string | null;
  ninea: string | null;
  rccm: string | null;
  naema_code: string | null;
  telephone: string | null;
  ville: string | null;
  region: string | null;
  segment: string | null;
  taille: string | null;
  score: number;
  categorie: "A" | "B" | "C" | "D";
  vague: number | null;
  statut_validation: string;
  commercial_id: number | null;
  commercial: string | null;
  statut: string;
  fictif: boolean;
  est_cliente: boolean;
}

export interface Interaction {
  id: number;
  entreprise_id: string;
  raison_sociale?: string;
  telephone?: string;
  date: string;
  type: string;
  tentative: number;
  joint: boolean;
  decideur_joint: boolean;
  rdv_obtenu: boolean;
  date_rdv: string | null;
  resultat: string | null;
  commentaire: string | null;
  prochaine_action: string | null;
  date_prochaine_action: string | null;
  action_faite: boolean;
  commercial: string | null;
  commercial_id: number | null;
  categorie?: string;
}

export interface Opportunite {
  id: number;
  entreprise_id: string;
  raison_sociale?: string;
  intitule: string | null;
  produit: string | null;
  etape: string;
  montant: number | null;
  devise: string;
  montant_fcfa: number;
  marge_pb: number | null;
  pnb_estime_fcfa: number;
  probabilite: number | null;
  date_ouverture: string | null;
  date_cloture_prevue: string | null;
  commercial: string | null;
  categorie?: string;
}

export interface Page<T> {
  total: number;
  items: T[];
}

export const TYPES_INTERACTION = ["Appel", "E-mail", "RDV", "Visite", "WhatsApp/SMS", "Autre"];
export const PRODUITS = ["Spot", "Forward", "Flexiterme", "Transferts"];
