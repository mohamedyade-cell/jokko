// Formats français : dates jj/mm/aaaa, montants FCFA avec séparateur de milliers.
const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export function dateFr(iso?: string | null): string {
  if (!iso) return "";
  const [d] = iso.split("T");
  const [y, m, j] = d.split("-");
  if (!y || !m || !j) return iso;
  return `${j}/${m}/${y}`;
}

export function dateHeureFr(iso?: string | null): string {
  if (!iso) return "";
  const [d, h] = iso.split("T");
  return `${dateFr(d)}${h ? " " + h.slice(0, 5) : ""}`;
}

export function nombre(n?: number | null): string {
  return n === null || n === undefined ? "—" : nf.format(n);
}

export function fcfa(n?: number | null): string {
  return n === null || n === undefined ? "—" : `${nf.format(n)} FCFA`;
}

export function montant(n: number | null | undefined, devise: string): string {
  if (n === null || n === undefined) return "—";
  return devise === "XOF" ? fcfa(n) : `${nf.format(n)} ${devise}`;
}

export function pct(n?: number | null): string {
  return n === null || n === undefined ? "—" : `${nf1.format(n)} %`;
}

export function aujourdhuiIso(): string {
  const d = new Date();
  const z = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function plusJours(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  const z = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export const ROLES: Record<string, string> = {
  fx_sales: "FX Sales",
  responsable: "Responsable Capital Market",
  lecture: "Lecture seule",
};
