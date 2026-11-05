import { Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from "react";
import { useActiveSection } from "../hooks/useActiveSection";
import { useDialogBehavior } from "../hooks/useDialogBehavior";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useHomeSections, usePublicLive, usePublicSports } from "../lib/PublicDataContext";
import { SportIcon } from "./kshitij/SportIcon";
import { getSportMeta } from "./kshitij/sportMeta";
import { springs } from "../motion/springs";
import type { SportDoc } from "../../shared/types";

function MobileMenu({
  headerRef,
  onClose,
  sports,
  liveBySport,
  currentSlug,
}: {
  headerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  sports: SportDoc[];
  liveBySport: Map<string, number>;
  currentSlug: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  useDialogBehavior(headerRef, onClose);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("a")?.focus();
  }, []);

  const hidden = reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -12 };

  return (
    <>
      <motion.div
        className="mobile-menu__scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.2 }}
        onClick={onClose}
      />
      <motion.div
        ref={ref}
        className="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        style={{ transformOrigin: "calc(100% - 34px) 0" }}
        initial={hidden}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={hidden}
        transition={reduced ? { duration: 0 } : springs.settle}
      >
        <nav className="mobile-menu__grid" aria-label="Sports">
          {sports.map((s) => {
            const meta = getSportMeta(s.slug);
            const live = liveBySport.get(s.sportId) ?? 0;
            return (
              <Link
                key={s.sportId}
                to={`/sports/${s.slug}`}
                className="mobile-menu__tile"
                aria-current={currentSlug === s.slug ? "page" : undefined}
                style={{ "--sport-accent": meta.accent, "--sport-accent-soft": meta.accentSoft } as CSSProperties}
                onClick={onClose}
              >
                <span className="mobile-menu__tile-top">
                  <SportIcon slug={s.slug} size={20} />
                  {live > 0 && (
                    <span className="sports-panel__live">
                      <span className="sports-panel__live-dot" aria-hidden="true" />
                      <span className="visually-hidden">Live</span>
                    </span>
                  )}
                </span>
                <span className="mobile-menu__tile-name">{s.name}</span>
              </Link>
            );
          })}
        </nav>
      </motion.div>
    </>
  );
}

export function Header() {
  const sports = usePublicSports();
  const liveFixtures = usePublicLive();
  const { homeSections } = useHomeSections();
  const location = useLocation();
  const { scrollY } = useScroll();
  const [elevated, setElevated] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const reduced = usePrefersReducedMotion();
  const headerRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  const isHome = location.pathname === "/";
  const sectionIds = useMemo(() => ["live-now", "sports", "results"].filter((id) => homeSections.has(id)), [homeSections]);
  const navSections = useMemo(() => ["sports", "results"].filter((id) => !isHome || homeSections.has(id)), [isHome, homeSections]);
  const selectors = useMemo(() => sectionIds.map((id) => `#${id}`), [sectionIds]);
  const activeSection = useActiveSection({ selectors, enabled: isHome });
  const currentSlug = location.pathname.startsWith("/sports/") ? location.pathname.split("/")[2] ?? null : null;

  useMotionValueEvent(scrollY, "change", (y) => setElevated(y > 32));

  useEffect(() => {
    setPanelOpen(false);
    setSheetOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!panelOpen) return;
    panelRef.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPanelOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setPanelOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [panelOpen]);

  const liveCount = liveFixtures?.length ?? 0;
  const liveBySport = useMemo(() => {
    const map = new Map<string, number>();
    (liveFixtures ?? []).forEach((f) => map.set(f.sportId, (map.get(f.sportId) ?? 0) + 1));
    return map;
  }, [liveFixtures]);

  const closeAll = () => {
    setPanelOpen(false);
    setSheetOpen(false);
  };

  const onSection = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    closeAll();
    if (!isHome) return;
    e.preventDefault();
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState(null, "", `#${id}`);
    }, 0);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    menuRef.current?.focus();
  };

  const sportList = sports ?? [];
  const panelCols = Math.min(5, Math.max(1, sportList.length));

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header ref={headerRef} className={`app-header ${elevated ? "is-elevated" : ""}`}>
        <div className="app-header__capsule">
          <Link to="/" className="app-header__brand">
            KSHITIJ
          </Link>

          <nav className="app-header__nav" aria-label="Primary">
            <button
              ref={triggerRef}
              type="button"
              className={`app-header__link ${panelOpen || currentSlug ? "is-active" : ""}`}
              aria-expanded={panelOpen}
              aria-controls="sports-panel"
              aria-current={currentSlug ? "page" : undefined}
              onClick={() => setPanelOpen((v) => !v)}
            >
              Sports
              <svg className="app-header__caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            {navSections.includes("sports") && (
              <Link
                to="/#sports"
                onClick={onSection("sports")}
                className={`app-header__link app-header__link--section ${isHome && activeSection === "#sports" ? "is-active" : ""}`}
                aria-current={isHome && activeSection === "#sports" ? "location" : undefined}
              >
                Fixtures
              </Link>
            )}
            {navSections.includes("results") && (
              <Link
                to="/#results"
                onClick={onSection("results")}
                className={`app-header__link app-header__link--section ${isHome && activeSection === "#results" ? "is-active" : ""}`}
                aria-current={isHome && activeSection === "#results" ? "location" : undefined}
              >
                Results
              </Link>
            )}
          </nav>

          <div className="app-header__actions">
            {liveCount > 0 && (
              <Link
                to="/#live-now"
                onClick={onSection("live-now")}
                className="app-header__live-pill"
              >
                <span className="app-header__live-dot" aria-hidden="true" />
                Live
              </Link>
            )}
            <button
              ref={menuRef}
              type="button"
              className="app-header__menu"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              aria-label={sheetOpen ? "Close menu" : "Open menu"}
              onClick={() => (sheetOpen ? closeSheet() : setSheetOpen(true))}
            >
              <span />
              <span />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {panelOpen && (
            <motion.div
              ref={panelRef}
              id="sports-panel"
              className="sports-panel"
              style={{ "--panel-cols": String(panelCols) } as CSSProperties}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={reduced ? { duration: 0 } : springs.settle}
            >
              <nav aria-label="Sports" className="sports-panel__list">
                {sportList.map((s) => {
                  const meta = getSportMeta(s.slug);
                  const live = liveBySport.get(s.sportId) ?? 0;
                  return (
                    <Link
                      key={s.sportId}
                      to={`/sports/${s.slug}`}
                      className="sports-panel__row"
                      aria-current={currentSlug === s.slug ? "page" : undefined}
                      style={{ "--sport-accent": meta.accent, "--sport-accent-soft": meta.accentSoft } as CSSProperties}
                      onClick={() => setPanelOpen(false)}
                    >
                      <SportIcon slug={s.slug} size={18} />
                      <span className="sports-panel__name">{s.name}</span>
                      {live > 0 && (
                        <span className="sports-panel__live">
                          <span className="sports-panel__live-dot" aria-hidden="true" />
                          <span className="visually-hidden">Live</span>
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {sheetOpen && (
            <MobileMenu
              key="mobile-menu"
              headerRef={headerRef}
              onClose={closeSheet}
              sports={sportList}
              liveBySport={liveBySport}
              currentSlug={currentSlug}
            />
          )}
        </AnimatePresence>
      </header>
    </>
  );
}
