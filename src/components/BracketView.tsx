import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { motion, type PanInfo } from "framer-motion";
import { useFixturesState, useMatchStates } from "../hooks/useFirestoreData";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { minWidth } from "../lib/breakpoints";
import { usePointerFine } from "../hooks/usePointerFine";
import { useInView } from "../hooks/useInView";
import { MatchTile } from "./MatchTile";
import { Segmented } from "./Segmented";
import { DirectionalSwap } from "./DirectionalSwap";
import { EmptyState, ErrorState, LoadingState } from "./states/StateViews";
import { roundLabel } from "../lib/format";
import { getSportMeta } from "./kshitij/sportMeta";
import { COL_GUTTER, COL_W, HEAD_H, MATCH_H, forwardChain, layoutRounds, type Positioned } from "../lib/bracketLayout";
import type { FixtureDoc, MatchStateDoc, SportDoc } from "../../shared/types";

export function BracketView({
  competitionId,
  onOpenFixture,
  sport,
  includeDrafts = false,
}: {
  competitionId: string;
  onOpenFixture: (id: string) => void;
  sport?: Pick<SportDoc, "matchConfiguration" | "slug"> | null;
  includeDrafts?: boolean;
}) {
  const fixturesState = useFixturesState(competitionId, includeDrafts);
  const fixtures = fixturesState.data;
  const isDesktop = useMediaQuery(minWidth("nav"));
  const pointerFine = usePointerFine();
  const [activeRound, setActiveRound] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [fit, setFit] = useState(false);
  const [wrapWidth, setWrapWidth] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, moved: false, startX: 0, startY: 0, left: 0, top: 0 });
  const { ref: treeRef, seen } = useInView<HTMLDivElement>(0);

  const rounds = useMemo(
    () => (fixtures ? Array.from(new Set(fixtures.map((f) => f.round))).sort((x, y) => x - y) : []),
    [fixtures]
  );
  const layout = useMemo<Map<number, Positioned[]>>(
    () => (fixtures ? layoutRounds(fixtures, rounds) : new Map()),
    [fixtures, rounds]
  );
  const stateIds = useMemo(
    () =>
      (fixtures ?? [])
        .filter((f) => f.status === "LIVE" || f.status === "COMPLETED")
        .map((f) => f.fixtureId)
        .sort(),
    [fixtures]
  );
  const states = useMatchStates(stateIds);
  const chain = useMemo(() => forwardChain(fixtures ?? [], hovered), [fixtures, hovered]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapWidth(el.clientWidth));
    ro.observe(el);
    setWrapWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [isDesktop, fixtures]);

  useEffect(() => {
    setActiveRound((i) => Math.min(i, Math.max(rounds.length - 1, 0)));
  }, [rounds.length]);

  if (fixturesState.error) {
    return <ErrorState title="The bracket couldn't be loaded" hint="Check your connection and try again." onRetry={fixturesState.retry} />;
  }
  if (fixtures === null) return <LoadingState label="Loading bracket" rows={3} />;
  if (fixtures.length === 0) {
    return <EmptyState sport={sport?.slug} title="Bracket will be published soon" hint="The draw hasn't been announced for this competition yet." />;
  }

  const stateFor = (f: FixtureDoc): MatchStateDoc | null | undefined =>
    f.status === "LIVE" || f.status === "COMPLETED" ? (states ? states.get(f.fixtureId) ?? null : undefined) : null;

  const treeWidth = rounds.length * COL_W + (rounds.length - 1) * COL_GUTTER;
  const maxY = Math.max(...Array.from(layout.values()).map((list) => Math.max(...list.map((p) => p.y), 0)));
  const treeHeight = maxY + MATCH_H / 2 + HEAD_H;
  const padX = 34;
  const canFit = wrapWidth > 0 && treeWidth + padX > wrapWidth;
  const scale = fit && canFit ? Math.max((wrapWidth - padX) / treeWidth, 0.55) : 1;

  const connectors: {
    key: string;
    d: string;
    status: "pending" | "live" | "completed";
    highlighted: boolean;
  }[] = [];
  rounds.forEach((r, ri) => {
    if (ri === rounds.length - 1) return;
    const current = layout.get(r) ?? [];
    const nextList = layout.get(rounds[ri + 1]) ?? [];
    current.forEach((p) => {
      const target = nextList.find((n) => n.fixture.fixtureId === p.fixture.nextFixtureId);
      if (!target) return;
      const x1 = ri * (COL_W + COL_GUTTER) + COL_W;
      const x2 = x1 + COL_GUTTER;
      const midX = (x1 + x2) / 2;
      const y1 = p.y + HEAD_H;
      const y2 = target.y + HEAD_H;
      connectors.push({
        key: `${p.fixture.fixtureId}->${target.fixture.fixtureId}`,
        d: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`,
        status: p.fixture.status === "COMPLETED" ? "completed" : p.fixture.status === "LIVE" ? "live" : "pending",
        highlighted: chain.has(p.fixture.fixtureId) && chain.has(target.fixture.fixtureId),
      });
    });
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointerFine || e.pointerType !== "mouse" || e.button !== 0 || scale !== 1) return;
    const el = wrapRef.current;
    if (!el) return;
    drag.current = { active: true, moved: false, startX: e.clientX, startY: e.clientY, left: el.scrollLeft, top: el.scrollTop };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = wrapRef.current;
    if (!d.active || !el) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
    if (d.moved) {
      el.scrollLeft = d.left - dx;
      el.scrollTop = d.top - dy;
    }
  };
  const endDrag = () => {
    drag.current.active = false;
  };
  const swallowClickAfterDrag = (e: React.MouseEvent) => {
    if (drag.current.moved) {
      e.stopPropagation();
      e.preventDefault();
      drag.current.moved = false;
    }
  };

  const goToRound = (next: number) => {
    const bounded = Math.max(0, Math.min(rounds.length - 1, next));
    if (bounded === activeRound) return;
    setActiveRound(bounded);
  };
  const onSwipe = (_: PointerEvent, info: PanInfo) => {
    if (info.offset.x < -60 || info.velocity.x < -500) goToRound(activeRound + 1);
    else if (info.offset.x > 60 || info.velocity.x > 500) goToRound(activeRound - 1);
  };

  const accent = sport?.slug ? getSportMeta(sport.slug).accent : null;
  const accentStyle = accent
    ? ({
        "--bracket-edge": `color-mix(in srgb, ${accent} 60%, transparent)`,
        "--bracket-tint": `color-mix(in srgb, ${accent} 6%, transparent)`,
      } as CSSProperties)
    : undefined;

  const roundOptions = rounds.map((r, i) => ({ value: String(i), label: roundLabel(r, rounds.length) }));
  const activeRoundMatches = layout.get(rounds[activeRound]) ?? [];
  const nextRoundName = activeRound < rounds.length - 1 ? roundLabel(rounds[activeRound + 1], rounds.length) : null;

  return (
    <div className="bracket-view" style={accentStyle}>
      {isDesktop ? (
        <div className="bracket-view__desktop">
          {canFit && (
            <div className="bracket-view__tools">
              <button type="button" className="bracket-view__tool" onClick={() => setFit((v) => !v)} aria-pressed={fit}>
                {fit ? "Actual size" : "Fit to view"}
              </button>
            </div>
          )}
          <div
            ref={wrapRef}
            className={`bracket-view__tree-wrap ${pointerFine && scale === 1 ? "is-pannable" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            onClickCapture={swallowClickAfterDrag}
          >
            <div className="bracket-view__tree-pad" style={{ width: treeWidth * scale, height: treeHeight * scale }}>
              <div
                ref={treeRef}
                className={`bracket-view__tree ${seen ? "is-in-view" : ""}`}
                style={{ width: treeWidth, height: treeHeight, transform: `scale(${scale})`, transformOrigin: "0 0" }}
              >
                <svg className="bracket-view__connectors" width={treeWidth} height={treeHeight} aria-hidden="true">
                  {connectors.map((c, i) => (
                    <path
                      key={c.key}
                      d={c.d}
                      pathLength={1}
                      fill="none"
                      style={{ animationDelay: `${Math.min(i * 15, 150)}ms` }}
                      className={`bracket-connector ${c.status !== "pending" ? `is-${c.status}` : ""} ${c.highlighted ? "is-highlighted" : ""}`}
                    />
                  ))}
                </svg>

                {rounds.map((r, ri) => {
                  const isFinalRound = ri === rounds.length - 1;
                  return (
                    <div key={r} className="bracket-view__round" style={{ left: ri * (COL_W + COL_GUTTER), width: COL_W }}>
                      <h4 className={`bracket-view__round-title ${isFinalRound ? "is-final" : ""}`}>
                        {roundLabel(r, rounds.length)}
                      </h4>
                      {(layout.get(r) ?? []).map((p) => (
                        <div
                          key={p.fixture.fixtureId}
                          className={`bracket-view__slot ${isFinalRound ? "bracket-view__slot--final" : ""} ${chain.has(p.fixture.fixtureId) && hovered ? "is-on-path" : ""}`}
                          style={{ top: p.y - MATCH_H / 2 + HEAD_H, height: MATCH_H }}
                          onPointerEnter={() => setHovered(p.fixture.fixtureId)}
                          onPointerLeave={() => setHovered(null)}
                          onFocus={() => setHovered(p.fixture.fixtureId)}
                          onBlur={() => setHovered(null)}
                        >
                          <MatchTile
                            fixture={p.fixture}
                            onOpen={onOpenFixture}
                            density="compact"
                            totalRounds={rounds.length}
                            sport={sport}
                            siblings={fixtures}
                            matchState={stateFor(p.fixture)}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bracket-view__mobile">
          <Segmented
            aria-label="Bracket round"
            skin="underline"
            options={roundOptions}
            value={String(activeRound)}
            onChange={(v) => goToRound(Number(v))}
          />
          <p className="bracket-view__progress">
            {nextRoundName ? `Winners advance to the ${nextRoundName}` : "Winner takes the title"}
            <span className="bracket-view__dots" aria-hidden="true">
              {rounds.map((r, i) => (
                <span key={r} className={i === activeRound ? "is-active" : ""} />
              ))}
            </span>
          </p>
          <motion.div className="bracket-view__swipe" drag="x" dragSnapToOrigin dragConstraints={{ left: 0, right: 0 }} dragElastic={0.2} onDragEnd={onSwipe}>
            <DirectionalSwap stateKey={activeRound} index={activeRound} className="bracket-view__round-list">
              {activeRoundMatches.map((p) => (
                <MatchTile
                  key={p.fixture.fixtureId}
                  fixture={p.fixture}
                  onOpen={onOpenFixture}
                  density="default"
                  totalRounds={rounds.length}
                  sport={sport}
                  siblings={fixtures}
                  matchState={stateFor(p.fixture)}
                />
              ))}
            </DirectionalSwap>
          </motion.div>
        </div>
      )}
    </div>
  );
}
