import { useId, useState } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { springs } from "../../motion/springs";
import { useAuth } from "../../lib/AuthContext";
import { useAdminScope } from "../../lib/useAdminScope";
import { DashboardPage } from "./DashboardPage";
import { FixturesPage } from "./FixturesPage";
import { LiveScoringPage } from "./LiveScoringPage";
import { ImportPage } from "./ImportPage";
import { BracketsPage } from "./BracketsPage";
import { ManagePage } from "./ManagePage";
import { LoadingState } from "../../components/states/StateViews";
import { Atmosphere } from "../../components/kshitij/Atmosphere";
import { ScrollToTop } from "../../components/immersive/ScrollToTop";
import logoUrl from "../../assets/kshitij-logo.png";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

function useNavItems(): NavItem[] {
  const { isSuper } = useAdminScope();
  return [
    { to: "/admin", label: "Dashboard", end: true },
    { to: "/admin/fixtures", label: "Fixtures" },
    ...(isSuper
      ? [
          { to: "/admin/brackets", label: "Brackets" },
          { to: "/admin/import", label: "Import" },
          { to: "/admin/manage", label: "Manage" },
        ]
      : []),
  ];
}

function NavLinks({ items }: { items: NavItem[] }) {
  const layoutId = useId();
  return (
    <>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "is-active" : "")}>
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId={`${layoutId}-indicator`} className="admin-nav__indicator" transition={springs.settle} />}
              <span className="admin-nav__label">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

function Gate({ title, body, action }: { title: string; body?: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="admin-gate">
      <Atmosphere />
      <div className="admin-gate__logo" role="img" aria-label="KSHITIJ 3.0" style={{ WebkitMaskImage: `url(${logoUrl})`, maskImage: `url(${logoUrl})` }} />
      <h1>{title}</h1>
      {body && <p>{body}</p>}
      {action && (
        <button type="button" className="admin-gate__signin" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function AdminFrame() {
  const { admin, signOutUser } = useAuth();
  const { isSuper, scopedSports } = useAdminScope();
  const items = useNavItems();
  const who = admin?.displayName ?? admin?.email ?? "";

  return (
    <div className="admin-shell">
      <Atmosphere intensity="low" />
      <ScrollToTop />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="admin-bar">
        <div className="admin-bar__capsule">
          <span className="admin-bar__brand">
            KSHITIJ <small>Control</small>
          </span>
          <nav className="admin-bar__nav" aria-label="Admin">
            <NavLinks items={items} />
          </nav>
          <div className="admin-bar__who">
            <span className="admin-bar__role" title={who}>
              {isSuper ? "Super admin" : "Coordinator"}
            </span>
            <button type="button" className="admin-bar__signout" aria-label={`Sign out ${who}`} onClick={() => void signOutUser()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="admin-shell__body" id="main">
        {!isSuper && scopedSports.length > 0 && (
          <p className="admin-shell__scope">
            Your sports <strong>{scopedSports.map((s) => s.name).join(" · ")}</strong>
          </p>
        )}
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="fixtures" element={<FixturesPage />} />
          <Route path="fixtures/:fixtureId/live" element={<LiveScoringPage />} />
          {isSuper && <Route path="brackets" element={<BracketsPage />} />}
          {isSuper && <Route path="import" element={<ImportPage />} />}
          {isSuper && <Route path="manage" element={<ManagePage />} />}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>

      <nav className="admin-dock" aria-label="Admin">
        <NavLinks items={items} />
      </nav>
    </div>
  );
}

const SIGN_IN_CANCELLED = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"];

export function AdminApp() {
  const { user, admin, loading, adminError, retryAdmin, signIn, signOutUser } = useAuth();
  const [signInError, setSignInError] = useState("");

  const runSignIn = async () => {
    setSignInError("");
    try {
      await signIn();
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (!SIGN_IN_CANCELLED.includes(code)) setSignInError("Sign-in didn't complete. Check your connection and try again.");
    }
  };

  if (loading) {
    return (
      <div className="admin-gate">
        <LoadingState label="Checking access" rows={1} />
      </div>
    );
  }
  if (!user) return <Gate title="Admin control room" body={signInError || undefined} action={{ label: "Sign in with Google", run: () => void runSignIn() }} />;
  if (adminError) {
    return (
      <Gate
        title="Couldn't check your access"
        body="Your admin record couldn't be loaded. Check your connection and try again."
        action={{ label: "Try again", run: retryAdmin }}
      />
    );
  }
  if (!admin || !admin.active) {
    return (
      <Gate
        title="Not authorized"
        body="Your account isn't set up as a Kshitij admin yet."
        action={{ label: "Sign out", run: () => void signOutUser() }}
      />
    );
  }
  return <AdminFrame />;
}
