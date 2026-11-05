import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { SectionHeading } from "./SectionHeading";
import { MatchTile } from "../MatchTile";
import { isByeFixture } from "../../lib/matchLabels";
import type { MatchStateMap } from "../../hooks/useFirestoreData";
import type { CompetitionDoc, FixtureDoc, SportDoc } from "../../../shared/types";

export function LiveBand({
  liveFixtures,
  liveStates,
  upcomingFixtures,
  sports,
  competitions,
  roundTotals,
  onOpen,
}: {
  liveFixtures: FixtureDoc[] | null;
  liveStates: MatchStateMap | null;
  upcomingFixtures: FixtureDoc[] | null;
  sports: SportDoc[] | null;
  competitions: CompetitionDoc[] | null;
  roundTotals: ReadonlyMap<string, number>;
  onOpen: (id: string) => void;
}) {
  const live = useMemo(
    () =>
      (liveFixtures ?? [])
        .filter((f) => !isByeFixture(f))
        .sort((a, b) => a.sportId.localeCompare(b.sportId) || a.round - b.round || a.matchNumber - b.matchNumber),
    [liveFixtures]
  );
  const upcoming = useMemo(() => (upcomingFixtures ?? []).filter((f) => !isByeFixture(f)), [upcomingFixtures]);
  const states = liveStates;
  const hasLive = live.length > 0;
  const reduceMotion = usePrefersReducedMotion();

  const cardsRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });
  const [dragging, setDragging] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardsRef.current;
    const bar = barRef.current;
    const thumb = thumbRef.current;
    if (!el || !bar || !thumb) return;
    const update = () => {
      const overflow = el.scrollWidth - el.clientWidth;
      bar.hidden = overflow <= 4;
      if (overflow <= 4) return;
      const ratio = el.clientWidth / el.scrollWidth;
      const trackW = bar.clientWidth;
      const thumbW = Math.max(trackW * ratio, 32);
      thumb.style.width = `${thumbW}px`;
      thumb.style.transform = `translateX(${(el.scrollLeft / overflow) * (trackW - thumbW)}px)`;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [live, upcoming, hasLive]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = cardsRef.current;
    if (!el) return;
    drag.current = { active: true, moved: false, startX: e.clientX, startLeft: el.scrollLeft };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = cardsRef.current;
    if (!d.active || !el) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true;
      setDragging(true);
    }
    if (d.moved) el.scrollLeft = d.startLeft - dx;
  };
  const endDrag = () => {
    if (!drag.current.active) return;
    drag.current.active = false;
    setDragging(false);
    const el = cardsRef.current;
    if (el && drag.current.moved) {
      const card = el.firstElementChild as HTMLElement | null;
      const w = (card?.getBoundingClientRect().width ?? 0) + 16;
      if (w > 16) el.scrollTo({ left: Math.round(el.scrollLeft / w) * w, behavior: reduceMotion ? "auto" : "smooth" });
    }
    window.setTimeout(() => {
      drag.current.moved = false;
    }, 0);
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) {
      e.stopPropagation();
      e.preventDefault();
      drag.current.moved = false;
    }
  };

  const tile = (f: FixtureDoc) => {
    const sport = sports?.find((s) => s.sportId === f.sportId);
    return (
      <MatchTile
        key={f.fixtureId}
        fixture={f}
        onOpen={onOpen}
        density="card"
        showSport
        sportName={sport?.name}
        sport={sport}
        competitionName={competitions?.find((c) => c.competitionId === f.competitionId)?.name}
        totalRounds={roundTotals.get(f.competitionId) || undefined}
        matchState={f.status === "LIVE" ? (states ? states.get(f.fixtureId) ?? null : undefined) : null}
      />
    );
  };

  return (
    <section className="home-section live-band" id="live-now">
      <div className="container">
        <SectionHeading title={hasLive ? "Live now" : "Up next"} />

        {hasLive || upcoming.length > 0 ? (
          <div className="live-band__row">
            <div
              ref={cardsRef}
              className={`live-band__cards${dragging ? " is-dragging" : ""}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerLeave={endDrag}
              onClickCapture={onClickCapture}
            >
              {(hasLive ? live : upcoming).map(tile)}
            </div>
            <div className="live-band__bar" ref={barRef} aria-hidden="true">
              <div className="live-band__bar-thumb" ref={thumbRef} />
            </div>
          </div>
        ) : (
          <div className="live-band__empty">
            <span className="live-band__empty-text">No matches live right now</span>
            <a className="live-band__empty-hint" href="#sports">
              Browse sports for fixtures
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
