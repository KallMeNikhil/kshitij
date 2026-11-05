import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";
import type { AdminDoc } from "../../shared/types";

interface AuthState {
  user: User | null;
  admin: AdminDoc | null;
  loading: boolean;
  adminError: boolean;
  retryAdmin: () => void;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [admin, setAdmin] = useState<AdminDoc | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [adminReady, setAdminReady] = useState(false);
  const [adminError, setAdminError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    setAdmin(null);
    setAdminError(false);
    setAdminReady(false);
    if (!user?.email) return;
    const email = user.email.toLowerCase();
    const unsub = onSnapshot(
      doc(db, "admins", email),
      (snap) => {
        setAdmin(snap.exists() ? (snap.data() as AdminDoc) : null);
        setAdminError(false);
        setAdminReady(true);
      },
      (err) => {
        setAdmin(null);
        setAdminError(err.code !== "permission-denied");
        setAdminReady(true);
      }
    );
    return unsub;
  }, [user, nonce]);

  const retryAdmin = useCallback(() => setNonce((n) => n + 1), []);
  const loading = !authReady || (!!user?.email && !adminReady);

  const signIn = async () => {
    await signInWithPopup(auth, googleProvider);
  };
  const signOutUser = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, admin, loading, adminError, retryAdmin, signIn, signOutUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
