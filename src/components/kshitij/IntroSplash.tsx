import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { animate, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "framer-motion";
import logoUrl from "../../assets/kshitij-logo.png";
import { easeOutExpo } from "../../motion/easing";

const SESSION_KEY = "kshitij-intro-seen";
const START = 0.3;
const STAGGER = 0.13;
const IGNITE = 0.5;
const FLICKER = [0, 1, 0.15, 0.9, 0.3, 1, 0.85, 1];
const FLICKER_TIMES = [0, 0.08, 0.2, 0.34, 0.5, 0.66, 0.82, 1];
const LETTERS = [
  { l: 0, r: 0.18 },
  { l: 0.18, r: 0.347 },
  { l: 0.347, r: 0.535 },
  { l: 0.535, r: 0.617 },
  { l: 0.617, r: 0.787 },
  { l: 0.787, r: 0.853 },
  { l: 0.853, r: 1 },
];
const BALL = { x: 0.578, y: 0.14 };
const SHUTTLE = { x: 0.806, y: 0.12 };

interface Geometry {
  w: number;
  h: number;
  heroTop: number;
  logo: { left: number; top: number; width: number; height: number };
}

function readGeometry(): Geometry {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let rect = { left: 0, top: 0, width: 0, height: 0 };
  const el = document.querySelector(".kshitij-hero__logo");
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width > 0) rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  if (rect.width === 0) {
    const width = Math.min(w * 0.86, 820);
    const height = (width * 432) / 1100;
    rect = { left: (w - width) / 2, top: (h - height) / 2, width, height };
  }
  return { w, h, heroTop: rect.top, logo: { left: rect.left, top: (h - rect.height) / 2, width: rect.width, height: rect.height } };
}

function finishIntro() {
  document.documentElement.removeAttribute("data-intro");
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {}
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function Beam({ x, tx, ty, delay, px, peak, wide }: { x: number; tx: number; ty: number; delay: number; px: MotionValue<number>; peak: number; wide: number }) {
  const originY = -34;
  const dx = tx - x;
  const dy = ty - originY;
  const dist = Math.hypot(dx, dy);
  const base = -(Math.atan2(dx, dy) * 180) / Math.PI;
  const rotate = useTransform(px, (v) => base - v * 3);
  const width = Math.max(200, dist * 0.62, wide);
  return (
    <motion.div
      className="intro__beam"
      style={{ left: x - width / 2, top: originY, width, height: dist * 1.5, rotate }}
      initial={{ opacity: 0 }}
      animate={{ opacity: FLICKER.map((v) => v * peak) }}
      transition={{ duration: IGNITE, delay, times: FLICKER_TIMES }}
    >
      <div className="intro__beam-cone" />
    </motion.div>
  );
}

function Glint({ x, delay }: { x: number; delay: number }) {
  return (
    <motion.div
      className="intro__glint"
      style={{ left: x }}
      initial={{ opacity: 0 }}
      animate={{ opacity: FLICKER }}
      transition={{ duration: IGNITE, delay, times: FLICKER_TIMES }}
    />
  );
}

function Pool({ x, y, width, delay }: { x: number; y: number; width: number; delay: number }) {
  return (
    <motion.div
      className="intro__pool"
      style={{ left: x - width / 2, top: y - width * 0.3, width, height: width * 0.6 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: FLICKER.map((v) => v * 0.7) }}
      transition={{ duration: IGNITE, delay, times: FLICKER_TIMES }}
    />
  );
}

function Twinkle({ x, y, delay, size }: { x: number; y: number; delay: number; size: number }) {
  return (
    <motion.span
      className="intro__twinkle"
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: size, height: size }}
      initial={{ opacity: 0, scale: 0.2, rotate: 0 }}
      animate={{ opacity: [0, 1, 0], scale: [0.2, 1.15, 0.5], rotate: [0, 0, 25] }}
      transition={{ duration: 0.7, delay, times: [0, 0.3, 1], ease: easeOutExpo }}
    />
  );
}

export function IntroSplash() {
  const [active] = useState(() => typeof document !== "undefined" && document.documentElement.dataset.intro === "playing");
  const [geo, setGeo] = useState<Geometry | null>(null);
  const [lifting, setLifting] = useState(false);
  const [gone, setGone] = useState(false);
  const [ready, setReady] = useState(false);
  const [snap, setSnap] = useState(false);
  const power = useMotionValue(0);
  const rawX = useMotionValue(0);
  const px = useSpring(rawX, { stiffness: 70, damping: 18, mass: 0.6 });
  const zoom = useMotionValue(1);

  const liftedRef = useRef(false);
  const failsafeRef = useRef<number | undefined>(undefined);
  const autoRef = useRef<number | undefined>(undefined);
  const glideRef = useRef<number | undefined>(undefined);
  const skipRef = useRef<number | undefined>(undefined);
  const skippingRef = useRef(false);
  const mountedAt = useRef(performance.now());

  const lift = useCallback(() => {
    if (liftedRef.current) return;
    liftedRef.current = true;
    window.clearTimeout(failsafeRef.current);
    window.clearTimeout(autoRef.current);
    finishIntro();
    document.documentElement.setAttribute("data-intro-glide", "1");
    setLifting(true);
    glideRef.current = window.setTimeout(() => setGone(true), 1000);
  }, []);

  const skip = useCallback(() => {
    if (liftedRef.current || skippingRef.current) return;
    skippingRef.current = true;
    window.clearTimeout(failsafeRef.current);
    window.clearTimeout(autoRef.current);
    setSnap(true);
    skipRef.current = window.setTimeout(lift, 160);
  }, [lift]);

  const lampCount = geo && geo.w < 700 ? 3 : 5;
  const lastIgnite = START + (lampCount - 1) * STAGGER + IGNITE;
  const letterStart = START + 0.25;
  const letterStagger = 0.1;
  const letterEnd = letterStart + (LETTERS.length + 1) * letterStagger + 0.35;
  const litAt = Math.max(lastIgnite, letterEnd);

  useEffect(() => {
    if (!active || liftedRef.current) return;
    window.scrollTo(0, 0);
    failsafeRef.current = window.setTimeout(lift, 6000);
    const onKey = () => skip();
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(failsafeRef.current);
      window.removeEventListener("keydown", onKey);
    };
  }, [active, lift, skip]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const done = () => {
      if (alive) setReady(true);
    };
    const timeout = window.setTimeout(done, 1500);
    const finish = () => {
      window.clearTimeout(timeout);
      done();
    };
    const img = new Image();
    img.src = logoUrl;
    if (typeof img.decode === "function") {
      img.decode().then(finish, finish);
    } else {
      img.onload = finish;
      img.onerror = finish;
    }
    return () => {
      alive = false;
      window.clearTimeout(timeout);
    };
  }, [active]);

  useEffect(() => {
    if (!active || !ready || liftedRef.current) return;
    const wait = Math.max(0, 300 - (performance.now() - mountedAt.current));
    const measure = window.setTimeout(() => setGeo(readGeometry()), wait);
    return () => window.clearTimeout(measure);
  }, [active, ready]);

  useEffect(
    () => () => {
      window.clearTimeout(glideRef.current);
      window.clearTimeout(skipRef.current);
      document.documentElement.removeAttribute("data-intro-glide");
    },
    [],
  );

  useLayoutEffect(() => {
    if (gone) document.documentElement.removeAttribute("data-intro-glide");
  }, [gone]);

  useEffect(() => {
    if (!geo || liftedRef.current) return;
    const ramp = animate(power, [0, 0.22, 0.14, 0.5, 0.42, 0.78, 0.7, 1], { duration: litAt - START, delay: START, ease: "linear" });
    const push = animate(zoom, 1.05, { duration: litAt + 1, ease: "linear" });
    autoRef.current = window.setTimeout(lift, (litAt + 0.55) * 1000);
    return () => {
      ramp.stop();
      push.stop();
      window.clearTimeout(autoRef.current);
    };
  }, [geo, litAt, lift, power, zoom]);

  const floorY = geo ? geo.logo.top + geo.logo.height + (geo.h - geo.logo.top - geo.logo.height) * 0.3 : 0;
  const crowd = useMemo(() => {
    const rnd = seeded(11);
    const top = geo ? floorY : 0;
    const span = geo ? geo.h - floorY : 0;
    return Array.from({ length: 16 }, () => ({ x: 3 + rnd() * 94, y: top + span * (0.12 + rnd() * 0.8), s: 1.4 + rnd() * 1.2, d: 3 + rnd() * 3, o: rnd() * 5 }));
  }, [geo, floorY]);

  const motes = useMemo(() => {
    const rnd = seeded(7);
    return Array.from({ length: 26 }, () => ({ x: 0.14 + rnd() * 0.72, y: 0.1 + rnd() * 0.75, s: 1.4 + rnd() * 2, d: 5 + rnd() * 6, o: rnd() * 4 }));
  }, []);

  const hazeOpacity = power;
  const floorOpacity = useTransform(power, [0, 1], [0, 1]);
  const crowdOpacity = useTransform(power, [0.2, 0.9], [0, 0.85]);

  if (!active || gone) return null;

  const w = geo?.w ?? window.innerWidth;
  const h = geo?.h ?? window.innerHeight;
  const logo = geo?.logo;
  const targetX = logo ? logo.left + logo.width / 2 : w / 2;
  const targetY = logo ? logo.top + logo.height * 0.5 : h / 2;
  const mid = (lampCount - 1) / 2;
  const desktop = w >= 700;
  const beams = Array.from({ length: lampCount }, (_, i) => {
    const x = w * (0.14 + (0.72 * i) / (lampCount - 1));
    const spread = logo ? logo.width * 0.2 : 40;
    const tx = targetX + (i - mid) * spread;
    const t = (floorY + 34) / (targetY + 34);
    return { x, tx, ty: targetY, delay: START + i * STAGGER, fx: x + (tx - x) * t };
  });
  const wide = desktop && logo ? logo.width * 0.55 : 0;
  const peak = desktop ? 0.72 : 0.95;

  const letterAnim = (i: number) => {
    if (snap) {
      return {
        initial: { opacity: 0.05, filter: "brightness(0.5)" },
        animate: { opacity: 1, filter: "brightness(1)" },
        transition: { duration: 0.15, ease: "easeOut" as const },
      };
    }
    const delay = letterStart + i * letterStagger;
    return {
      initial: { opacity: 0.05, filter: "brightness(0.5)" },
      animate: { opacity: [0.05, 1, 0.4, 1, 0.85, 1], filter: ["brightness(0.5)", "brightness(1.5)", "brightness(0.8)", "brightness(1.35)", "brightness(1.1)", "brightness(1)"] },
      transition: { duration: 0.45, delay, times: [0, 0.18, 0.38, 0.6, 0.8, 1] },
    };
  };

  return createPortal(
    <div className="intro" aria-hidden="true" onPointerDown={skip} onPointerMove={(e) => rawX.set((e.clientX / w - 0.5) * 2)}>
      <motion.div
        className="intro__stage"
        initial={false}
        animate={lifting ? { opacity: 0 } : { opacity: 1 }}
        transition={lifting ? { duration: 0.75, delay: 0.18, ease: [0.4, 0, 0.2, 1] } : { duration: 0 }}
      >
        <div className="intro__vignette" />

        {geo && (
          <motion.div className="intro__scene" style={{ scale: zoom, transformOrigin: `${targetX}px ${targetY}px` }}>
            <motion.div
              className="intro__haze"
              style={{ opacity: hazeOpacity, background: `radial-gradient(ellipse 62% 56% at ${targetX}px ${targetY}px, rgba(150, 210, 255, 0.3), rgba(70, 130, 210, 0.09) 55%, transparent 80%)` }}
            />

            <motion.div className="intro__crowd" style={{ opacity: crowdOpacity }}>
              {crowd.map((c, i) => (
                <span key={i} style={{ left: `${c.x}%`, top: `${c.y}%`, width: c.s, height: c.s, animationDuration: `${c.d}s`, animationDelay: `-${c.o}s` }} />
              ))}
            </motion.div>

            {beams.map((b, i) => (
              <Beam key={`b${i}`} x={b.x} tx={b.tx} ty={b.ty} delay={b.delay} px={px} peak={peak} wide={wide} />
            ))}

            <motion.div className="intro__motes" style={{ opacity: hazeOpacity }}>
              {motes.map((m, i) => (
                <span key={i} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: m.s, height: m.s, animationDuration: `${m.d}s`, animationDelay: `-${m.o}s` }} />
              ))}
            </motion.div>

            {beams.map((b, i) => (
              <Glint key={`g${i}`} x={b.x} delay={b.delay} />
            ))}

            {logo && (
              <>
                <motion.div
                  className="intro__floor"
                  style={{ top: logo.top + logo.height + 8, bottom: 0, opacity: floorOpacity }}
                />
                <motion.svg className="intro__lanes" style={{ top: floorY - 10, opacity: floorOpacity }} width={w} height={h - floorY + 10} viewBox={`0 0 ${w} ${h - floorY + 10}`} preserveAspectRatio="none">
                  {Array.from({ length: 9 }, (_, i) => {
                    const bx = w * (-0.5 + (2 * i) / 8);
                    return <line key={i} x1={w / 2 + (bx - w / 2) * 0.12} y1={0} x2={bx} y2={h - floorY + 10} stroke="currentColor" strokeWidth="1" />;
                  })}
                </motion.svg>
                {beams.map((b, i) => (
                  <Pool key={`p${i}`} x={b.fx} y={floorY + (h - floorY) * 0.55} width={Math.max(160, wide ? wide * 0.7 : (logo?.width ?? 300) * 0.5)} delay={b.delay} />
                ))}
                <div className="intro__fog" style={{ top: floorY + (h - floorY) * 0.35 }} />
              </>
            )}

            <motion.div
              className="intro__surge"
              style={{ background: `radial-gradient(circle at ${targetX}px ${targetY}px, rgba(235, 247, 255, 0.95), rgba(150, 210, 255, 0.35) 35%, transparent 65%)` }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.4, 0] }}
              transition={{ duration: 0.6, delay: litAt - 0.05, times: [0, 0.18, 1], ease: easeOutExpo }}
            />

          </motion.div>
        )}
      </motion.div>

      {lifting && (
        <motion.div
          className="intro__bloom"
          style={{ background: `radial-gradient(ellipse 60% 55% at ${targetX}px ${targetY}px, rgba(236, 248, 255, 0.95), rgba(150, 210, 255, 0.4) 45%, transparent 75%)` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.75, 0] }}
          transition={{ duration: 0.85, times: [0, 0.28, 1], ease: "easeOut" }}
        />
      )}

      {logo && (
        <motion.div
          className="intro__logo-box"
          style={{ left: logo.left, top: logo.top, width: logo.width, height: logo.height }}
          initial={false}
          animate={{ y: lifting && geo ? geo.heroTop - geo.logo.top : 0 }}
          transition={{ duration: 0.9, ease: [0.65, 0, 0.25, 1] }}
        >
          {LETTERS.map((seg, i) => (
            <motion.div
              key={i}
              className="intro__logo"
              style={{ clipPath: `inset(0 ${(1 - seg.r) * 100}% 25% ${seg.l * 100}%)`, WebkitMaskImage: `url(${logoUrl})`, maskImage: `url(${logoUrl})` }}
              {...letterAnim(i)}
            />
          ))}
          <motion.div
            className="intro__logo"
            style={{ clipPath: "inset(74% 38% 0 40%)", WebkitMaskImage: `url(${logoUrl})`, maskImage: `url(${logoUrl})` }}
            {...letterAnim(LETTERS.length)}
          />
          {geo && (
            <motion.div
              className="intro__sweep"
              style={{ WebkitMaskImage: `url(${logoUrl})`, maskImage: `url(${logoUrl})` }}
              initial={{ backgroundPositionX: "170%", opacity: 0 }}
              animate={{ backgroundPositionX: "-70%", opacity: 1 }}
              transition={{ duration: 0.8, delay: litAt + 0.02, ease: [0.5, 0, 0.2, 1], opacity: { duration: 0 } }}
            />
          )}
          <Twinkle x={BALL.x} y={BALL.y} delay={litAt + 0.25} size={Math.max(46, logo.width * 0.07)} />
          <Twinkle x={SHUTTLE.x} y={SHUTTLE.y} delay={litAt + 0.4} size={Math.max(42, logo.width * 0.065)} />
        </motion.div>
      )}
    </div>,
    document.body,
  );
}
