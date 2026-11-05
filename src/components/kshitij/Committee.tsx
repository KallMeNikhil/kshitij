import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SectionHeading } from "./SectionHeading";
import { CommitteeSwitch } from "./CommitteeSwitch";
import { clamp, useAutoplay, useDwell } from "./StoryBar";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { minWidth } from "../../lib/breakpoints";
import { easeOutExpo } from "../../motion/easing";
import { durations } from "../../motion/durations";
import type { CommitteeMember } from "../../config/siteContent";
import { COMMITTEE_CATEGORIES, COMMITTEE_CATEGORY_LABELS, type CommitteeCategory } from "../../../shared/media";

const HUES = [205, 222, 238, 252, 190, 268];
const SWIPE_MIN = 40;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function TradingCard({
  member,
  seed,
  lead,
  active,
  eager,
}: {
  member: CommitteeMember;
  seed: number;
  lead: boolean;
  active: boolean;
  eager: boolean;
}) {
  const style = { "--hue": HUES[seed % HUES.length] } as CSSProperties;
  const focus = member.focus ?? { x: 50, y: 22 };
  return (
    <article
      className="tcard"
      data-lead={lead ? "true" : "false"}
      data-photo={member.photo ? "true" : "false"}
      data-active={active ? "true" : "false"}
      style={style}
    >
      <div className="tcard__portrait">
        {member.photo ? (
          <img
            src={member.photo}
            alt={`Portrait of ${member.name}`}
            style={{ objectPosition: `${focus.x}% ${focus.y}%` }}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
          />
        ) : (
          <span className="tcard__monogram" aria-hidden="true">
            {initials(member.name)}
          </span>
        )}
        <span className="frame-finish" aria-hidden="true" />
        <span className="crop-marks" aria-hidden="true" />
      </div>
    </article>
  );
}

function offsetOf(i: number, active: number, n: number): number {
  let d = (i - active + n) % n;
  if (d > n / 2) d -= n;
  return d;
}

function CommitteeStage({ members, label }: { members: CommitteeMember[]; label: string }) {
  const n = members.length;
  const reduced = usePrefersReducedMotion();
  const desktop = useMediaQuery(minWidth("nav"));
  const wide = useMediaQuery(minWidth("wide"));
  const reach = wide ? 2 : 1;
  const spread = wide ? 34 : desktop ? 46 : 27;

  const [active, setActive] = useState(0);
  const regionRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const tapOk = useRef(false);
  const prevOffsets = useRef<number[]>([]);
  const { running, bind, engage } = useAutoplay(regionRef, n > 1 && !reduced);

  const step = useCallback((d: number) => setActive((a) => (a + d + n) % n), [n]);
  const advance = useCallback(() => step(1), [step]);
  useDwell(running, active, advance);

  const offsets = members.map((_, i) => offsetOf(i, active, n));
  const wrapped = offsets.map((d, i) => prevOffsets.current[i] !== undefined && Math.abs(d - prevOffsets.current[i]) > n / 2);
  useEffect(() => {
    prevOffsets.current = offsets;
  });

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(n - 1);
    }
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY };
    tapOk.current = false;
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    tapOk.current = Math.hypot(dx, dy) < SWIPE_MIN;
    if (n > 1 && Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.2) step(dx < 0 ? 1 : -1);
  };

  const onPointerCancel = () => {
    swipe.current = null;
    tapOk.current = false;
  };

  const onTap = (i: number) => {
    if (!tapOk.current) return;
    tapOk.current = false;
    engage(true);
    setActive(i);
  };

  const current = members[active];
  const duration = reduced ? 0 : durations.contentReveal;

  return (
    <div
      ref={regionRef}
      className="committee__region"
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      {...bind}
    >
      <div className="committee__layout">
        <div className="committee__type" aria-hidden="true">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current.id}
              className="committee__type-body"
              initial={reduced ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -14 }}
              transition={{ duration: reduced ? 0 : durations.microInteraction, ease: easeOutExpo }}
            >
              <p className="committee__type-name">{current.name}</p>
              <p className="committee__type-role">{current.role}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="committee__stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
          {members.map((member, i) => {
            const d = offsets[i];
            const a = Math.abs(d);
            const shown = a <= reach;
            const side = clamp(d, -1, 1);
            const state = a === 0 ? "active" : shown ? "near" : "hidden";
            const animate = shown
              ? {
                  x: `${d * spread}%`,
                  scale: 1 - 0.13 * a,
                  opacity: a === 0 ? 1 : a === 1 ? 0.72 : 0.42,
                  rotate: d * 2.5,
                  zIndex: 10 - a,
                  filter: `brightness(${a === 0 ? 1 : a === 1 ? 0.66 : 0.5})`,
                }
              : {
                  x: `${side * spread * (reach + 1)}%`,
                  scale: 0.6,
                  opacity: 0,
                  rotate: 0,
                  zIndex: 0,
                  filter: "brightness(0.5)",
                };
            return (
              <motion.div
                key={member.id}
                className="committee__slot"
                data-state={state}
                aria-hidden={a === 0 ? undefined : true}
                role="group"
                aria-roledescription="slide"
                aria-label={a === 0 ? `${i + 1} of ${n}: ${member.name}, ${member.role}` : undefined}
                onClick={state === "near" ? () => onTap(i) : undefined}
                initial={false}
                animate={animate}
                transition={{ duration: wrapped[i] ? 0 : duration, ease: easeOutExpo }}
              >
                <TradingCard member={member} seed={i} lead={member.featured === true} active={a === 0} eager={a <= reach} />
              </motion.div>
            );
          })}
        </div>
      </div>

      <span className="visually-hidden" aria-live={running ? "off" : "polite"}>
        {`${current.name}, ${current.role}, ${active + 1} of ${n}`}
      </span>
    </div>
  );
}

function featuredFirst(members: CommitteeMember[]): CommitteeMember[] {
  return [...members.filter((m) => m.featured === true), ...members.filter((m) => m.featured !== true)];
}

export function Committee({ members }: { members: CommitteeMember[] }) {
  const reduced = usePrefersReducedMotion();
  const groups = useMemo(
    () =>
      COMMITTEE_CATEGORIES.map((category) => ({
        category,
        members: featuredFirst(members.filter((m) => m.category === category)),
      })).filter((group) => group.members.length > 0),
    [members]
  );
  const [picked, setPicked] = useState<CommitteeCategory>("faculty");

  if (groups.length === 0) return null;
  const group = groups.find((g) => g.category === picked) ?? groups[0];
  const label = `${COMMITTEE_CATEGORY_LABELS[group.category]}, organizing committee`;

  return (
    <section className="home-section committee" id="committee">
      <div className="container">
        <SectionHeading title="Organizing committee" centered />
        {groups.length > 1 && (
          <CommitteeSwitch
            label="Committee category"
            value={group.category}
            onChange={(value) => setPicked(value as CommitteeCategory)}
            options={groups.map((g) => ({ value: g.category, label: COMMITTEE_CATEGORY_LABELS[g.category] }))}
          />
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={group.category}
            role="tabpanel"
            aria-label={label}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: reduced ? 0 : durations.microInteraction, ease: easeOutExpo }}
          >
            <CommitteeStage members={group.members} label={label} />
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
