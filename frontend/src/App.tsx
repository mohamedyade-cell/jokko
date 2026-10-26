import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, Utilisateur } from "./api";
import { AuthCtx } from "./auth";
import Layout from "./components/Layout";
import { Chargement } from "./components/ui";
import Agenda from "./pages/Agenda";
import Audit from "./pages/Audit";
import Base from "./pages/Base";
import CallTracker from "./pages/CallTracker";
import Connexion from "./pages/Connexion";
import Doublons from "./pages/Doublons";
import Exports from "./pages/Exports";
import Fiche from "./pages/Fiche";
import Imports from "./pages/Imports";
import Parametres from "./pages/Parametres";
import Pipeline from "./pages/Pipeline";
import Qualite from "./pages/Qualite";
import TableauDeBord from "./pages/TableauDeBord";
import Wallet from "./pages/Wallet";

export default function App() {
  const [user, setUser] = useState<Utilisateur | null | undefined>(undefined);

  useEffect(() => {
    api.get<Utilisateur>("/api/auth/me").then(setUser).catch(() => setUser(null));
    const fin = () => setUser(null);
    window.addEventListener("radar:deconnexion", fin);
    return () => window.removeEventListener("radar:deconnexion", fin);
  }, []);

  if (user === undefined) return <Chargement />;
  if (user === null) return <Connexion onConnecte={setUser} />;

  const deconnecter = () => api.post("/api/auth/logout").finally(() => setUser(null));
  const resp = user.role === "responsable";

  return (
    <AuthCtx.Provider value={{ user, deconnecter }}>
      <Layout>
        <Routes>
          <Route path="/" element={<TableauDeBord />} />
          <Route path="/base" element={<Base />} />
          <Route path="/entreprises/:id" element={<Fiche />} />
          <Route path="/call-tracker" element={<CallTracker />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/doublons" element={<Doublons />} />
          <Route path="/qualite" element={<Qualite />} />
          <Route path="/exports" element={<Exports />} />
          {resp && <Route path="/parametres" element={<Parametres />} />}
          {resp && <Route path="/imports" element={<Imports />} />}
          {resp && <Route path="/audit" element={<Audit />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AuthCtx.Provider>
  );
}
