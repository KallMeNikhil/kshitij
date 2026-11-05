import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SectionHeading } from "./SectionHeading";
import { StoryBar, clamp, useAutoplay } from "./StoryBar";
import { useDialogBehavior } from "../../hooks/useDialogBehavior";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { usePointerFine } from "../../hooks/usePointerFine";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { minWidth } from "../../lib/breakpoints";
import { easeOutExpo } from "../../motion/easing";
import { durations } from "../../motion/durations";
import type { GalleryImage } from "../../config/siteContent";

const FRAME_WIDE = 16 / 10;
const FRAME_NARROW = 4 / 5;
const FILL_TOLERANCE = 1.3;
const SCROLL_LOCK_MS = 900;
const DRAG_THRESHOLD = 5;
const SWIPE_MIN = 50;

type Fit = "fill" | "contain";

function fitFor(ratio: number | null, frame: number): Fit {
  if (!ratio) return "fill";
  const skew = ratio > frame ? ratio / frame : frame / ratio;
  return skew <= FILL_TOLERANCE ? "fill" : "contain";
}

function focusStyle(item: GalleryImage): CSSProperties {
  return { "--fx": `${item.focus?.x ?? 50}%`, "--fy": `${item.focus?.y ?? 50}%` } as CSSProperties;
}

function Lightbox({
  items,
  index,
  onChange,
  onClose,
  onDismissed,
}: {
  items: GalleryImage[];
  index: number;
  onChange: (next: number) => void;
  onClose: () => void;
  onDismissed: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<number | null>(null);
  const [natural, setNatural] = useState<{ id: string; ratio: number } | null>(null);
  const dismissedRef = useRef(onDismissed);
  dismissedRef.current = onDismissed;
  useDialogBehavior(ref, onClose);
  useEffect(() => () => dismissedRef.current(), []);
  const item = items[index];
  const count = items.length;
  const ratio =
    natural && natural.id === item.id ? natural.ratio : item.width && item.height ? item.width / item.height : 1.6;

  const step = useCallback((d: number) => onChange((index + d + count) % count), [index, count, onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step]);

  const onPointerUp = (e: ReactPointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start === null || count < 2) return;
    const dx = e.clientX - start;
    if (Math.abs(dx) >= SWIPE_MIN) step(dx < 0 ? 1 : -1);
  };

  return (
    <motion.div
      ref={ref}
      className="gallery__lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Image ${index + 1} of ${count}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      onPointerDown={(e) => {
        swipeStart.current = e.clientX;
      }}
      onPointerUp={onPointerUp}
    >
      <motion.figure
        className="gallery__lightbox-frame"
        onClick={(e) => e.stopPropagation()}
        key={item.id}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: durations.microInteraction, ease: easeOutExpo }}
      >
        <div className="gallery__lightbox-media" style={{ "--ratio": ratio } as CSSProperties}>
          <img
            src={item.src}
            alt=""
            width={item.width}
            height={item.height}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) setNatural({ id: item.id, ratio: img.naturalWidth / img.naturalHeight });
            }}
          />
          <span className="crop-marks" aria-hidden="true" />
        </div>
      </motion.figure>
      <button type="button" className="gallery__lightbox-close" onClick={onClose} aria-label="Close image">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {count > 1 && (
        <>
          <button
            type="button"
            className="gallery__lightbox-nav gallery__lightbox-nav--prev"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            aria-label="Previous image"
          >
            ‹
          </button>
          <button
            type="button"
            className="gallery__lightbox-nav gallery__lightbox-nav--next"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            aria-label="Next image"
          >
            ›
          </button>
        </>
      )}
    </motion.div>
  );
}

function GalleryCard({
  item,
  position,
  count,
  fit,
  eager,
  parallax,
  onOpen,
  onNatural,
}: {
  item: GalleryImage;
  position: number;
  count: number;
  fit: Fit;
  eager: boolean;
  parallax: boolean;
  onOpen: (i: number) => void;
  onNatural: (id: string, ratio: number) => void;
}) {
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!parallax || e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const py = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    e.currentTarget.style.setProperty("--px", px.toFixed(3));
    e.currentTarget.style.setProperty("--py", py.toFixed(3));
  };

  const onLeave = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.style.setProperty("--px", "0");
    e.currentTarget.style.setProperty("--py", "0");
  };

  return (
    <div
      className="gallery__card"
      role="group"
      aria-roledescription="slide"
      aria-label={`${position + 1} of ${count}`}
      data-fit={fit}
      style={focusStyle(item)}
    >
      <button
        type="button"
        className="gallery-frame"
        onClick={() => onOpen(position)}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        aria-label={`Open image ${position + 1} of ${count}`}
      >
        {fit === "contain" && (
          <img className="gallery-frame__backdrop" src={item.thumb ?? item.src} alt="" aria-hidden="true" loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} />
        )}
        <img
          className="gallery-frame__image"
          src={item.src}
          alt=""
          width={item.width}
          height={item.height}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (!item.width || !item.height) onNatural(item.id, img.naturalWidth / img.naturalHeight);
          }}
        />
        <span className="frame-finish" aria-hidden="true" />
        <span className="crop-marks" aria-hidden="true" />
      </button>
    </div>
  );
}

export function Gallery({ items }: { items: GalleryImage[] }) {
  const wide = useMediaQuery(minWidth("tablet"));
  const twoUp = useMediaQuery(minWidth("nav"));
  const pointerFine = usePointerFine();
  const reduced = usePrefersReducedMotion();

  const count = items.length;
  const per = twoUp ? 2 : 1;
  const stops = Math.max(1, count - per + 1);
  const frame = wide ? FRAME_WIDE : FRAME_NARROW;

  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [natural, setNatural] = useState<Record<string, number>>({});

  const regionRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(0);
  const lockUntil = useRef(0);
  const frameRaf = useRef(0);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const lastOpen = useRef(0);

  activeRef.current = active;

  const { running, bind } = useAutoplay(regionRef, !reduced && stops > 1, open !== null);

  const stepWidth = useCallback(() => {
    const track = trackRef.current;
    if (!track) return 0;
    const first = track.children[0] as HTMLElement | undefined;
    const second = track.children[1] as HTMLElement | undefined;
    if (!first) return 0;
    return second ? second.offsetLeft - first.offsetLeft : track.clientWidth;
  }, []);

  const sync = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const step = stepWidth();
    if (step > 0 && performance.now() >= lockUntil.current) {
      const next = clamp(Math.round(track.scrollLeft / step), 0, stops - 1);
      setActive((prev) => (prev === next ? prev : next));
    }
    if (!reduced) {
      const box = track.getBoundingClientRect();
      const mid = box.left + box.width / 2;
      for (const child of Array.from(track.children) as HTMLElement[]) {
        const r = child.getBoundingClientRect();
        const shift = clamp((r.left + r.width / 2 - mid) / box.width, -1, 1);
        child.style.setProperty("--shift", shift.toFixed(3));
      }
    }
  }, [reduced, stepWidth, stops]);

  const onScroll = useCallback(() => {
    if (frameRaf.current) return;
    frameRaf.current = requestAnimationFrame(() => {
      frameRaf.current = 0;
      sync();
    });
  }, [sync]);

  const goTo = useCallback(
    (stop: number, instant = false) => {
      const track = trackRef.current;
      if (!track) return;
      const target = clamp(stop, 0, stops - 1);
      const smooth = !instant && !reduced;
      lockUntil.current = smooth ? performance.now() + SCROLL_LOCK_MS : 0;
      track.scrollTo({ left: target * stepWidth(), behavior: smooth ? "smooth" : "auto" });
      setActive(target);
    },
    [reduced, stepWidth, stops]
  );

  const advance = useCallback(() => goTo(activeRef.current + 1 >= stops ? 0 : activeRef.current + 1), [goTo, stops]);

  useEffect(() => {
    setActive((a) => Math.min(a, stops - 1));
  }, [stops]);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: Math.min(activeRef.current, stops - 1) * stepWidth(), behavior: "auto" });
    sync();
  }, [per, wide, count, stops, stepWidth, sync]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      track.scrollTo({ left: Math.min(activeRef.current, stops - 1) * stepWidth(), behavior: "auto" });
      sync();
    });
    ro.observe(track);
    return () => ro.disconnect();
  }, [stops, stepWidth, sync]);

  useEffect(
    () => () => {
      if (frameRaf.current) cancelAnimationFrame(frameRaf.current);
    },
    []
  );

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(activeRef.current + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(activeRef.current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      goTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      goTo(stops - 1);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointerFine || e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > DRAG_THRESHOLD) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.dataset.dragging = "true";
    }
    if (d.moved) e.currentTarget.scrollLeft = d.left - dx;
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) return;
    const track = e.currentTarget;
    delete track.dataset.dragging;
    if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
    const step = stepWidth();
    const dx = e.clientX - d.x;
    const dir = Math.abs(dx) > step * 0.15 ? (dx < 0 ? 1 : -1) : 0;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    goTo(Math.round(d.left / step) + dir);
  };

  const changeOpen = useCallback((next: number) => {
    lastOpen.current = next;
    setOpen(next);
  }, []);

  const close = useCallback(() => setOpen(null), []);

  const restore = useCallback(() => {
    goTo(Math.min(lastOpen.current, stops - 1), true);
    const card = trackRef.current?.children[lastOpen.current] as HTMLElement | undefined;
    card?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, [goTo, stops]);

  const onNatural = useCallback((id: string, ratio: number) => {
    setNatural((prev) => (prev[id] === ratio ? prev : { ...prev, [id]: ratio }));
  }, []);

  if (count === 0) return null;

  return (
    <section className="home-section gallery" id="gallery">
      <div className="container">
        <SectionHeading title="Gallery" />
        <div
          ref={regionRef}
          className="gallery__stage"
          role="region"
          aria-roledescription="carousel"
          aria-label="Gallery"
          style={{ "--gallery-per": per, "--gallery-ratio": wide ? "16 / 10" : "4 / 5" } as CSSProperties}
          onKeyDown={onKeyDown}
          {...bind}
        >
          <div
            ref={trackRef}
            className="gallery__track"
            aria-live={running ? "off" : "polite"}
            onScroll={onScroll}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClickCapture={(e) => {
              if (suppressClick.current) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            {items.map((item, i) => {
              const ratio = item.width && item.height ? item.width / item.height : (natural[item.id] ?? null);
              return (
                <GalleryCard
                  key={item.id}
                  item={item}
                  position={i}
                  count={count}
                  fit={fitFor(ratio, frame)}
                  eager={i < per + 1}
                  parallax={pointerFine && !reduced}
                  onOpen={changeOpen}
                  onNatural={onNatural}
                />
              );
            })}
          </div>
          {stops > 1 && (
            <div className="story-meta">
              <StoryBar count={stops} active={active} running={running} animate={!reduced} onElapsed={advance} />
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {open !== null && <Lightbox items={items} index={open} onChange={changeOpen} onClose={close} onDismissed={restore} />}
      </AnimatePresence>
    </section>
  );
}
