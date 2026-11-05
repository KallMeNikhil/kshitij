import { useCallback, useEffect, useRef, type PointerEvent, type RefObject } from "react";

const TOUCH_DELAY_MS = 90;
const TAP_FADE_MS = 140;
const MOVE_CANCEL_PX = 8;

export interface PointerSheenHandlers<T extends HTMLElement> {
  ref: RefObject<T | null>;
  onPointerDown: (e: PointerEvent<T>) => void;
  onPointerMove: (e: PointerEvent<T>) => void;
  onPointerUp: (e: PointerEvent<T>) => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
}

export function usePointerSheen<T extends HTMLElement = HTMLDivElement>(): PointerSheenHandlers<T> {
  const ref = useRef<T>(null);
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number; lx: number; ly: number } | null>(null);
  const stopScroll = useRef<(() => void) | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const clearScrollWatch = useCallback(() => {
    stopScroll.current?.();
    stopScroll.current = null;
  }, []);

  const glow = useCallback((x: number, y: number) => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--mx", `${x}px`);
    el.style.setProperty("--my", `${y}px`);
    el.style.setProperty("--sheen", "1");
    el.dataset.pressed = "true";
  }, []);

  const release = useCallback(() => {
    clearTimer();
    clearScrollWatch();
    origin.current = null;
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--sheen", "0");
    delete el.dataset.pressed;
  }, [clearTimer, clearScrollWatch]);

  useEffect(
    () => () => {
      clearTimer();
      clearScrollWatch();
    },
    [clearTimer, clearScrollWatch]
  );

  const onPointerDown = (e: PointerEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const lx = e.clientX - r.left;
    const ly = e.clientY - r.top;
    if (e.pointerType === "mouse") {
      if (e.button === 0) glow(lx, ly);
      return;
    }
    clearTimer();
    clearScrollWatch();
    origin.current = { x: e.clientX, y: e.clientY, lx, ly };
    timer.current = window.setTimeout(() => {
      timer.current = null;
      glow(lx, ly);
    }, TOUCH_DELAY_MS);
    const onScroll = () => release();
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    stopScroll.current = () => window.removeEventListener("scroll", onScroll, true);
  };

  const onPointerMove = (e: PointerEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    if (e.pointerType === "mouse") {
      const r = el.getBoundingClientRect();
      glow(e.clientX - r.left, e.clientY - r.top);
      if (e.buttons === 0) delete el.dataset.pressed;
      return;
    }
    const o = origin.current;
    if (!o) return;
    if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_CANCEL_PX) release();
  };

  const onPointerUp = (e: PointerEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    if (e.pointerType === "mouse") {
      delete el.dataset.pressed;
      return;
    }
    const o = origin.current;
    if (o && timer.current !== null) {
      clearTimer();
      clearScrollWatch();
      origin.current = null;
      glow(o.lx, o.ly);
      timer.current = window.setTimeout(release, TAP_FADE_MS);
      return;
    }
    release();
  };

  return { ref, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: release, onPointerLeave: release };
}
