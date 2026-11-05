import { useEffect, useRef, useState, type CSSProperties } from "react";
import { motion, useMotionValue, useScroll, useSpring, useTransform } from "framer-motion";
import logoUrl from "../../assets/kshitij-logo.png";
import { Reveal } from "../immersive/Reveal";
import { IconChipButton } from "../immersive/IconChipButton";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { usePointerFine } from "../../hooks/usePointerFine";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { minWidth } from "../../lib/breakpoints";
import { usePublicDetails } from "../../lib/PublicDataContext";
import { createSlitTileVars, SLIT_BASE_VARS } from "../../lib/heroSlitTiles";

function introPlaying(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.intro === "playing";
}

export interface HeroAction {
  label: string;
  onClick: () => void;
}

export function KshitijHero({
  primary,
  secondary,
}: {
  primary: HeroAction;
  secondary: HeroAction | null;
}) {
  const ref = useRef<HTMLElement>(null);
  const { eventLabel, heroTitle } = usePublicDetails();
  const [introAtMount] = useState(introPlaying);
  const reduced = usePrefersReducedMotion();
  const isDesktop = useMediaQuery(minWidth("nav"));
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });

  const artY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : isDesktop ? -50 : -16]);
  const artOpacity = useTransform(scrollYProgress, [0, 0.85], [1, 0]);
  const slitFarX = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : isDesktop ? -30 : -12]);
  const slitMidX = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : isDesktop ? -80 : -30]);
  const slitNearX = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : isDesktop ? -160 : -60]);
  const contentY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : isDesktop ? -90 : -24]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const fine = usePointerFine();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 20, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 60, damping: 20, mass: 0.6 });
  const midX = useTransform(sx, (v) => v * 18);
  const midY = useTransform(sy, (v) => v * 10);
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!fine || reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) el.removeAttribute("data-offscreen");
      else el.setAttribute("data-offscreen", "");
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section className="kshitij-hero" ref={ref} id="hero" onPointerMove={onPointerMove}>
      <motion.div className="kshitij-hero__art" style={{ y: artY, opacity: artOpacity }} aria-hidden="true">
        <div className="kshitij-hero__glow" />
        <SlitScanField far={slitFarX} mid={slitMidX} near={slitNearX} />
      </motion.div>

      <motion.div className="container kshitij-hero__content" style={{ y: contentY, opacity: contentOpacity }}>
        <div className="kshitij-hero__stage">
          <div className="kshitij-hero__top">
            <Reveal variant="fade" delay={0.05} className="kshitij-hero__eyebrow">
              {eventLabel}
            </Reveal>
          </div>

          <h1 className="kshitij-hero__title">
            <span className="visually-hidden">{heroTitle}</span>
            <motion.span
              className="kshitij-hero__logo"
              aria-hidden="true"
              style={{ x: midX, y: midY, WebkitMaskImage: `url(${logoUrl})`, maskImage: `url(${logoUrl})` }}
              initial={introAtMount ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.9, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            />
          </h1>

          <div className="kshitij-hero__bottom">
            <Reveal variant="fade-up" delay={0.28} className="kshitij-hero__actions">
              <IconChipButton onClick={primary.onClick}>{primary.label}</IconChipButton>
              {secondary && (
                <button type="button" className="kshitij-cta kshitij-cta--ghost" onClick={secondary.onClick}>
                  {secondary.label}
                </button>
              )}
            </Reveal>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

type MV = ReturnType<typeof useTransform<number, number>>;
type LayerKind = "far" | "mid" | "near";

function useSlitVars(): CSSProperties {
  const [deferred] = useState(introPlaying);
  const [vars, setVars] = useState<Record<string, string>>(SLIT_BASE_VARS);
  const [waiting, setWaiting] = useState(deferred);
  useEffect(() => {
    const html = document.documentElement;
    let alive = true;
    let current: ReturnType<typeof createSlitTileVars> | null = null;
    let introObserver: MutationObserver | null = null;

    const build = () => {
      current = createSlitTileVars();
      setVars(current.vars);
    };

    if (introPlaying()) {
      introObserver = new MutationObserver(() => {
        if (introPlaying()) return;
        introObserver?.disconnect();
        introObserver = null;
        build();
        requestAnimationFrame(() => {
          if (alive) setWaiting(false);
        });
      });
      introObserver.observe(html, { attributes: true, attributeFilter: ["data-intro"] });
    } else {
      build();
      setWaiting(false);
    }

    const themeObserver = new MutationObserver(() => {
      if (!current) return;
      const next = createSlitTileVars();
      const previous = current;
      current = next;
      setVars(next.vars);
      window.setTimeout(previous.release, 1000);
    });
    themeObserver.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      alive = false;
      introObserver?.disconnect();
      themeObserver.disconnect();
      current?.release();
    };
  }, []);
  if (!deferred) return vars as CSSProperties;
  return { ...vars, opacity: waiting ? 0 : 1, transition: "opacity 0.5s ease-out" } as CSSProperties;
}

function SlitLane({ kind, x }: { kind: LayerKind; x: MV }) {
  return (
    <motion.div className="kshitij-hero__slit-lane" style={{ x }}>
      <div className={`kshitij-hero__slit-band kshitij-hero__slit-band--${kind}`} />
    </motion.div>
  );
}

interface SlitZone {
  top: number;
  bottom: number;
  phase: number;
}

const SLIT_ZONES: Record<LayerKind, SlitZone[]> = {
  far: [
    { top: 0, bottom: 45, phase: 0 },
    { top: 20, bottom: 5, phase: 17 },
    { top: 50, bottom: 0, phase: 41 },
  ],
  mid: [
    { top: 0, bottom: 30, phase: 0 },
    { top: 28, bottom: 42, phase: 9 },
    { top: 45, bottom: 0, phase: 15 },
  ],
  near: [{ top: 0, bottom: 0, phase: 0 }],
};

function SlitLayer({ kind, x }: { kind: LayerKind; x: MV }) {
  return (
    <>
      {SLIT_ZONES[kind].map((zone, i) => (
        <div
          key={i}
          className="kshitij-hero__slit-zone"
          style={{ "--zt": `${zone.top}%`, "--zb": `${zone.bottom}%`, "--zp": `${zone.phase}s` } as CSSProperties}
        >
          <SlitLane kind={kind} x={x} />
          <div className={`kshitij-hero__slit-flash kshitij-hero__slit-flash--${kind}`}>
            <div className="kshitij-hero__slit-flash-inner">
              <SlitLane kind={kind} x={x} />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function SlitScanField({ far, mid, near }: { far: MV; mid: MV; near: MV }) {
  const vars = useSlitVars();
  return (
    <div className="kshitij-hero__slit" style={vars}>
      <SlitLayer kind="far" x={far} />
      <SlitLayer kind="mid" x={mid} />
      <SlitLayer kind="near" x={near} />
    </div>
  );
}
