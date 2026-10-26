import { createContext, useContext } from "react";
import type { Utilisateur } from "./api";

export const AuthCtx = createContext<{ user: Utilisateur; deconnecter: () => void } | null>(null);

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("AuthCtx manquant");
  return ctx;
}

export const estResponsable = (u: Utilisateur) => u.role === "responsable";
export const peutSaisir = (u: Utilisateur) => u.role !== "lecture";
