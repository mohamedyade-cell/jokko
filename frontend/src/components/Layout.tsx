import { ReactNode, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";
import { ROLES } from "../format";

const LIENS = [
  { to: "/", libelle: "Tableau de bord" },
  { to: "/base", libelle: "Base entreprises" },
  { to: "/call-tracker", libelle: "Call Tracker", saisie: true },
  { to: "/agenda", libelle: "Agenda" },
  { to: "/pipeline", libelle: "Pipeline" },
  { to: "/wallet", libelle: "Sales Wallet" },
  { to: "/doublons", libelle: "Doublons" },
  { to: "/qualite", libelle: "Contrôle qualité" },
  { to: "/exports", libelle: "Exports" },
  { to: "/parametres", libelle: "Paramètres", resp: true },
  { to: "/imports", libelle: "Imports", resp: true },
  { to: "/audit", libelle: "Journal d'audit", resp: true },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, deconnecter } = useAuth();
  const [menu, setMenu] = useState(false);
  const liens = LIENS.filter((l) => (!l.resp || user.role === "responsable") && (!l.saisie || user.role !== "lecture"));
  return (
    <div className="min-h-screen">
      {user.jeu_fictif && (
        <div className="bg-yellow-300 px-4 py-1 text-center text-xs font-bold uppercase tracking-wide text-yellow-950">
          Données fictives — jeu de démonstration, aucune entreprise réelle
        </div>
      )}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-sunu px-4 py-3 text-white shadow">
        <div className="flex items-center gap-3">
          <button className="lg:hidden" onClick={() => setMenu(!menu)} aria-label="Menu">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          <span className="text-lg font-bold tracking-wide">SUNU <span className="font-light">FX SALES RADAR</span></span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden sm:inline">{user.nom} · <span className="opacity-80">{ROLES[user.role]}</span></span>
          <button className="rounded border border-white/60 px-2 py-1 text-xs hover:bg-white hover:text-sunu" onClick={deconnecter}>Déconnexion</button>
        </div>
      </header>
      <div className="flex">
        <nav className={`${menu ? "block" : "hidden"} fixed inset-y-0 left-0 top-[52px] z-20 w-60 border-r border-gray-200 bg-white p-3 lg:static lg:block lg:min-h-[calc(100vh-52px)]`}>
          {liens.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.to === "/"} onClick={() => setMenu(false)}
              className={({ isActive }) => `block rounded-md px-3 py-2 text-sm ${isActive ? "bg-sunu-clair font-semibold text-sunu" : "text-gray-700 hover:bg-gray-100"}`}>
              {l.libelle}
            </NavLink>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-3 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
