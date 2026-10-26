import { FormEvent, useEffect, useState } from "react";
import { api, ErreurApi, Utilisateur } from "../api";
import { Erreur } from "../components/ui";

export default function Connexion({ onConnecte }: { onConnecte: (u: Utilisateur) => void }) {
  const [login, setLogin] = useState("");
  const [mdp, setMdp] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [cfg, setCfg] = useState<{ entra_active: boolean; comptes_locaux: boolean }>({ entra_active: false, comptes_locaux: true });

  useEffect(() => {
    api.get<typeof cfg>("/api/auth/config").then(setCfg).catch(() => {});
  }, []);

  const envoyer = (e: FormEvent) => {
    e.preventDefault();
    api.post<Utilisateur>("/api/auth/login", { login, mot_de_passe: mdp }).then(onConnecte).catch((x: ErreurApi) => setErreur(x.message));
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 rounded-t-lg bg-sunu px-6 py-5 text-white">
          <div className="text-2xl font-bold">SUNU</div>
          <div className="text-sm tracking-widest">FX SALES RADAR</div>
        </div>
        <div className="carte space-y-4">
          <Erreur texte={erreur} />
          {cfg.comptes_locaux && (
            <form onSubmit={envoyer} className="space-y-3">
              <div>
                <label className="etiquette" htmlFor="login">Identifiant</label>
                <input id="login" className="champ" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
              </div>
              <div>
                <label className="etiquette" htmlFor="mdp">Mot de passe</label>
                <input id="mdp" type="password" className="champ" autoComplete="current-password" value={mdp} onChange={(e) => setMdp(e.target.value)} required />
              </div>
              <button className="btn-primaire w-full" type="submit">Se connecter</button>
            </form>
          )}
          {cfg.entra_active && (
            <a className="btn-secondaire w-full" href="/api/auth/entra/login">Se connecter avec Microsoft 365</a>
          )}
          <p className="text-xs text-gray-500">Usage interne SUNU Bank — Capital Market. Accès tracé.</p>
        </div>
      </div>
    </div>
  );
}
