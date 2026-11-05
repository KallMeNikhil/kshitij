import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { AuthProvider } from "./lib/AuthContext";
import { Header } from "./components/Header";
import { HomePage } from "./pages/public/HomePage";
import { SportPage } from "./pages/public/SportPage";
import { AdminApp } from "./pages/admin/AdminApp";
import { ScrollProgress } from "./components/immersive/ScrollProgress";
import { PageTransition } from "./components/immersive/PageTransition";
import { ScrollToTop } from "./components/immersive/ScrollToTop";
import { Atmosphere } from "./components/kshitij/Atmosphere";
import { ThemeToggle } from "./components/ThemeToggle";
import { KshitijFooter } from "./components/kshitij/KshitijFooter";
import { NotFoundState } from "./components/states/StateViews";
import { LiveAnnouncer } from "./components/LiveAnnouncer";
import { PublicDataProvider } from "./lib/PublicDataContext";

function NotFoundPage() {
  return <NotFoundState title="Page not found" hint="That page doesn't exist or has moved." />;
}

function PublicShell() {
  const location = useLocation();
  return (
    <PublicDataProvider>
      <Atmosphere />
      <LiveAnnouncer />
      <ScrollProgress />
      <ScrollToTop />
      <Header />
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageTransition><HomePage /></PageTransition>} />
        <Route path="/sports" element={<Navigate to="/#sports" replace />} />
        <Route path="/sports/:sportSlug" element={<PageTransition><SportPage /></PageTransition>} />
        <Route path="*" element={<PageTransition><NotFoundPage /></PageTransition>} />
      </Routes>
      <KshitijFooter />
      <ThemeToggle />
    </PublicDataProvider>
  );
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/admin/*" element={<AdminApp />} />
          <Route path="*" element={<PublicShell />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </MotionConfig>
  );
}
