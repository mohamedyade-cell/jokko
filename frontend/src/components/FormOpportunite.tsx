import { FormEvent, useState } from "react";
import { api, ErreurApi, Opportunite, PRODUITS } from "../api";
import { ChampDate, Erreur, useToast } from "./ui";

export default function FormOpportunite({ entrepriseId, etapes, devises, existante, onEnregistre }: {
  entrepriseId: string; etapes: { nom: string; probabilite: number }[]; devises: string[]; existante?: Opportunite; onEnregistre: () => void;
}) {
  const notifier = useToast();
  const [o, setO] = useState({
    intitule: existante?.intitule ?? "", produit: existante?.produit ?? "Spot", etape: existante?.etape ?? etapes[0]?.nom ?? "",
    montant: existante?.montant ?? null as number | null, devise: existante?.devise ?? "EUR", marge_pb: existante?.marge_pb ?? null as number | null,
    probabilite: existante?.probabilite ?? null as number | null, date_ouverture: existante?.date_ouverture ?? null as string | null,
    date_cloture_prevue: existante?.date_cloture_prevue ?? null as string | null,
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const set = <K extends keyof typeof o>(k: K, v: (typeof o)[K]) => setO((x) => ({ ...x, [k]: v }));
  const envoyer = (e: FormEvent) => {
    e.preventDefault();
    const corps = { ...o, entreprise_id: entrepriseId, intitule: o.intitule || null };
    (existante ? api.put(`/api/opportunites/${existante.id}`, corps) : api.post("/api/opportunites", corps))
      .then(() => { notifier("Opportunité enregistrée"); onEnregistre(); })
      .catch((x: ErreurApi) => setErreur(x.message));
  };
  const nombre = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\s/g, "").replace(",", ".")));
  return (
    <form onSubmit={envoyer} className="space-y-3">
      <Erreur texte={erreur} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="etiquette" htmlFor="oi">Intitulé</label><input id="oi" className="champ" value={o.intitule} onChange={(e) => set("intitule", e.target.value)} /></div>
        <div><label className="etiquette" htmlFor="op">Produit</label><select id="op" className="champ" value={o.produit} onChange={(e) => set("produit", e.target.value)}>{PRODUITS.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="etiquette" htmlFor="oe">Étape</label><select id="oe" className="champ" value={o.etape} onChange={(e) => set("etape", e.target.value)}>{etapes.map((x) => <option key={x.nom} value={x.nom}>{x.nom} ({x.probabilite} %)</option>)}</select></div>
        <div><label className="etiquette" htmlFor="om">Montant</label><input id="om" className="champ" inputMode="decimal" value={o.montant ?? ""} onChange={(e) => set("montant", nombre(e.target.value))} /></div>
        <div><label className="etiquette" htmlFor="od">Devise</label><select id="od" className="champ" value={o.devise} onChange={(e) => set("devise", e.target.value)}>{devises.map((d) => <option key={d}>{d}</option>)}</select></div>
        <div><label className="etiquette" htmlFor="omp">Marge (points de base)</label><input id="omp" className="champ" inputMode="decimal" placeholder="défaut paramétré" value={o.marge_pb ?? ""} onChange={(e) => set("marge_pb", nombre(e.target.value))} /></div>
        <div><label className="etiquette" htmlFor="opr">Probabilité (%)</label><input id="opr" className="champ" inputMode="numeric" placeholder="selon l'étape" value={o.probabilite ?? ""} onChange={(e) => set("probabilite", nombre(e.target.value))} /></div>
        <div><label className="etiquette">Date d'ouverture</label><ChampDate valeur={o.date_ouverture} onChange={(v) => set("date_ouverture", v)} /></div>
        <div><label className="etiquette">Clôture prévue</label><ChampDate valeur={o.date_cloture_prevue} onChange={(v) => set("date_cloture_prevue", v)} /></div>
      </div>
      <button className="btn-primaire">Enregistrer</button>
    </form>
  );
}
