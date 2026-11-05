import { useCallback, useEffect, useRef, useState, type FocusEvent, type PointerEvent, type RefObject } from "react";
import { linear } from "../../motion/easing";

export const DWELL_MS = 4500;
const RESUME_GRACE_MS = 1600;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function useAutoplay(regionRef: RefObject<HTMLElement | null>, enabled: boolean, hold = false) {
  const [inView, setInView] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const graceRef = useRef<number | null>(null);

  useEffect(() => {
    const node = regionRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { threshold: 0.3 });
    io.observe(node);
    return () => io.disconnect();
  }, [regionRef]);

  useEffect(() => {
    const onVisibility = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(
    () => () => {
      if (graceRef.current !== null) window.clearTimeout(graceRef.current);
    },
    []
  );

  const engage = useCallback((release: boolean) => {
    if (graceRef.current !== null) window.clearTimeout(graceRef.current);
    graceRef.current = null;
    setEngaged(true);
    if (release) {
      graceRef.current = window.setTimeout(() => {
        graceRef.current = null;
        setEngaged(false);
      }, RESUME_GRACE_MS);
    }
  }, []);

  const bind = {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === "mouse") setHovered(true);
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === "mouse") setHovered(false);
    },
    onFocus: (e: FocusEvent) => {
      let visible = true;
      try {
        visible = (e.target as HTMLElement).matches(":focus-visible");
      } catch {
        visible = true;
      }
      if (visible) setFocused(true);
    },
    onBlur: (e: FocusEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
    },
    onTouchStart: () => engage(false),
    onTouchEnd: () => engage(true),
    onTouchCancel: () => engage(true),
    onWheel: () => engage(true),
  };

  const running = enabled && inView && tabVisible && !hovered && !focused && !engaged && !hold;
  return { running, bind, engage };
}

export function useDwell(running: boolean, cycleKey: unknown, onElapsed: () => void) {
  const callback = useRef(onElapsed);
  callback.current = onElapsed;
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => callback.current(), DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [running, cycleKey]);
}

export function StoryBar({
  count,
  active,
  running,
  animate,
  onElapsed,
}: {
  count: number;
  active: number;
  running: boolean;
  animate: boolean;
  onElapsed: () => void;
}) {
  return (
    <div className="story-bar" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`story-bar__seg${i < active ? " is-done" : ""}${i === active ? " is-active" : ""}`}>
          {i === active && (
            <i
              key={active}
              className={`story-bar__fill${animate ? "" : " is-static"}`}
              style={
                animate
                  ? { animationDuration: `${DWELL_MS}ms`, animationTimingFunction: linear, animationPlayState: running ? "running" : "paused" }
                  : undefined
              }
              onAnimationEnd={animate ? onElapsed : undefined}
            />
          )}
        </span>
      ))}
    </div>
  );
}
