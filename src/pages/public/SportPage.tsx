import { useCallback, useMemo, useRef, type CSSProperties } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { useCompetitionsState, useFixturesState, useMatchStates, useSportUpcomingState } from "../../hooks/useFirestoreData";
import { usePublicLive, usePublicLiveError, usePublicRetry, usePublicSports, usePublicSportsStatus } from "../../lib/PublicDataContext";
import { MatchTile } from "../../components/MatchTile";
import { BracketView } from "../../components/BracketView";
import { MatchModal } from "../../components/MatchModal";
import { Segmented } from "../../components/Segmented";
import { DirectionalSwap } from "../../components/DirectionalSwap";
import { OptionPicker } from "../../components/OptionSheet";
import { useResolvedSlot } from "../../hooks/useEntity";
import { Reveal } from "../../components/immersive/Reveal";
import { SportIcon } from "../../components/kshitij/SportIcon";
import { SportAtmosphere } from "../../components/kshitij/SportAtmosphere";
import { getSportMeta } from "../../components/kshitij/sportMeta";
import { EmptyState, ErrorState, LoadingState, NotFoundState } from "../../components/states/StateViews";
import { countRounds, groupFixtures } from "../../lib/fixtureGroups";
import { formatDate, formatDateTime, roundLabel as roundLabelFor } from "../../lib/format";
import { isByeFixture } from "../../lib/matchLabels";
import type { FixtureDoc, MatchStateDoc, SportDoc } from "../../../shared/types";

type StateLookup = (f: FixtureDoc) => MatchStateDoc | null | undefined;

function FixtureSection({
  title,
  fixtures,
  sport,
  totalRounds,
  siblings,
  stateFor,
  onOpen,
}: {
  title: string;
  fixtures: FixtureDoc[];
  sport: SportDoc;
  totalRounds: number;
  siblings: FixtureDoc[] | null;
  stateFor: StateLookup;
  onOpen: (id: string) => void;
}) {
  const rounds: { round: number; fixtures: FixtureDoc[] }[] = [];
  for (const f of fixtures) {
    const group = rounds.find((r) => r.round === f.round);
    if (group) group.fixtures.push(f);
    else rounds.push({ round: f.round, fixtures: [f] });
  }
  return (
    <section className="sport-page__section">
      <h3 className="sport-page__group-title">{title}</h3>
      {rounds.map((r) => (
        <div key={r.round} className="sport-page__round-group">
          <div className="sport-page__round">
            <span className="sport-page__round-tick" aria-hidden="true" />
            <span className="sport-page__round-name">{totalRounds > 0 ? roundLabelFor(r.round, totalRounds) : `Round ${r.round}`}</span>
            {totalRounds > 0 && (
              <span className="sport-page__round-progress">
                {r.round} / {totalRounds}
              </span>
            )}
          </div>
          {r.fixtures.map((f) => (
            <MatchTile key={f.fixtureId} fixture={f} onOpen={onOpen} density="row" showRound={false} sport={sport} totalRounds={totalRounds} siblings={siblings} matchState={stateFor(f)} />
          ))}
        </div>
      ))}
    </section>
  );
}

const PICKER_THRESHOLD = 4;

function NextMatchLine({ fixture }: { fixture: FixtureDoc }) {
  const a = useResolvedSlot(fixture.slotA);
  const b = useResolvedSlot(fixture.slotB);
  const when = formatDateTime(fixture.scheduledDate, fixture.scheduledTime);
  return (
    <span className="sport-page__next">
      <span className="sport-page__next-label">Next</span>
      <span className="sport-page__next-text">
        {a?.label ?? "…"} vs {b?.label ?? "…"}
        {when ? ` · ${when}` : ""}
      </span>
    </span>
  );
}

export function SportPage() {
  const { sportSlug } = useParams();
  const sports = usePublicSports();
  const sport = sports?.find((s) => s.slug === sportSlug) ?? null;
  const sportsStatus = usePublicSportsStatus();
  const retryPublic = usePublicRetry();
  const competitionsState = useCompetitionsState(sport?.sportId ?? null);
  const competitions = competitionsState.data;
  const liveAll = usePublicLive();
  const sportUpcoming = useSportUpcomingState(sport?.sportId ?? null);
  const upcomingAll = sportUpcoming.data;
  const scheduleError = usePublicLiveError() || sportUpcoming.error;
  const [searchParams, setSearchParams] = useSearchParams();
  const openFixture = searchParams.get("match");

  const view = searchParams.get("view") === "bracket" ? "bracket" : "fixtures";
  const requestedCompetition = searchParams.get("comp");
  const activeCompetition =
    competitions?.find((c) => c.competitionId === requestedCompetition) ?? competitions?.[0] ?? null;
  const activeCompetitionId = activeCompetition?.competitionId ?? null;

  const fixturesState = useFixturesState(activeCompetitionId);
  const fixtures = fixturesState.data;
  const grouped = useMemo(() => {
    const g = groupFixtures(fixtures ?? []);
    return { ...g, live: g.live.filter((f) => !isByeFixture(f)), completed: g.completed.filter((f) => !isByeFixture(f)) };
  }, [fixtures]);
  const totalRounds = useMemo(() => countRounds(fixtures), [fixtures]);
  const stateIds = useMemo(
    () =>
      (fixtures ?? [])
        .filter((f) => f.status === "LIVE" || f.status === "COMPLETED")
        .map((f) => f.fixtureId)
        .sort(),
    [fixtures]
  );
  const states = useMatchStates(stateIds);
  const stateFor: StateLookup = (f) =>
    f.status === "LIVE" || f.status === "COMPLETED" ? (states ? states.get(f.fixtureId) ?? null : undefined) : null;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const controlsRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const measure = () => rootRef.current?.style.setProperty("--sport-controls-h", `${el.offsetHeight}px`);
    measure();
    observerRef.current = new ResizeObserver(measure);
    observerRef.current.observe(el);
  }, []);

  const update = (mutate: (next: URLSearchParams) => void, replace = false) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace });
  };
  const setView = (v: string) => update((n) => (v === "bracket" ? n.set("view", "bracket") : n.delete("view")));
  const setCompetition = (id: string) => update((n) => n.set("comp", id));
  const setOpenFixture = (id: string | null) => update((n) => (id ? n.set("match", id) : n.delete("match")));

  if (sportsStatus.error) {
    return (
      <div className="container sport-page__loading" id="main">
        <ErrorState title="Sports couldn't be loaded" hint="Check your connection and try again." onRetry={sportsStatus.retry} />
      </div>
    );
  }

  if (!sports) {
    return (
      <div className="container sport-page__loading" id="main">
        <LoadingState label="Loading sport" rows={5} />
      </div>
    );
  }

  if (!sport) {
    return (
      <NotFoundState
        title="Sport not found"
        hint="That sport isn't part of this edition of KSHITIJ."
        action={
          <Link to="/#sports" className="state-view__action">
            See all sports
          </Link>
        }
      />
    );
  }

  const meta = getSportMeta(sport.slug);
  const style = { "--sport-accent": meta.accent, "--sport-accent-soft": meta.accentSoft } as CSSProperties;
  const liveCount = (liveAll ?? []).filter((f) => f.sportId === sport.sportId && !isByeFixture(f)).length;
  const hasMultipleCompetitions = (competitions?.length ?? 0) > 1;
  const showAside = view === "fixtures" && fixtures !== null && fixtures.length > 0;

  const competitionOptions = (competitions ?? []).map((c) => ({ value: c.competitionId, label: c.name }));
  const competitionTabs =
    hasMultipleCompetitions && competitions && (competitions.length > PICKER_THRESHOLD ? (
      <OptionPicker title="Competition" options={competitionOptions} value={activeCompetitionId ?? ""} onChange={setCompetition} />
    ) : (
      <Segmented
        aria-label="Competition"
        skin="underline"
        className="sport-page__tabs"
        options={competitionOptions}
        value={activeCompetitionId ?? ""}
        onChange={setCompetition}
      />
    ));

  const sportLive = (liveAll ?? []).filter((f) => f.sportId === sport.sportId && !isByeFixture(f));
  const sportNext = (upcomingAll ?? []).find((f) => f.sportId === sport.sportId) ?? null;
  const allDone = fixtures !== null && fixtures.length > 0 && fixtures.every((f) => f.status === "COMPLETED" || f.status === "CANCELLED");
  const nextLine = scheduleError ? (
    <span className="sport-page__next">
      <span className="sport-page__next-text">The schedule couldn't be loaded.</span>
      <button type="button" className="sport-page__retry" onClick={() => { retryPublic(); sportUpcoming.retry(); }}>
        Try again
      </button>
    </span>
  ) : liveAll === null || upcomingAll === null ? (
      <span className="sport-page__next">
        <span className="sport-page__next-text">Checking the schedule…</span>
      </span>
    ) : sportLive.length > 0 ? null : sportNext ? (
      <NextMatchLine fixture={sportNext} />
    ) : (
      <span className="sport-page__next">
        <span className="sport-page__next-text">{allDone ? "All matches in this competition are complete" : "No upcoming matches scheduled"}</span>
      </span>
    );

  const liveCompetitionIds = new Set(sportLive.map((f) => f.competitionId));

  const competitionRail = hasMultipleCompetitions && competitions && (
    <Segmented
      aria-label="Competition"
      skin="rail"
      options={competitions.map((c) => ({
        value: c.competitionId,
        label: c.name,
        icon: <SportIcon slug={sport.slug} size={14} />,
        live: liveCompetitionIds.has(c.competitionId),
      }))}
      value={activeCompetitionId ?? ""}
      onChange={setCompetition}
    />
  );

  const viewToggle = (
    <Segmented
      aria-label="View"
      skin="pill"
      options={[
        { value: "fixtures", label: "Fixtures" },
        { value: "bracket", label: "Bracket" },
      ]}
      value={view}
      onChange={setView}
    />
  );

  const renderFixtures = () => {
    if (fixturesState.error) {
      return <ErrorState title="Fixtures couldn't be loaded" hint="Check your connection and try again." onRetry={fixturesState.retry} />;
    }
    if (fixtures === null) return <LoadingState label="Loading fixtures" />;
    if (fixtures.length === 0) {
      return <EmptyState sport={sport.slug} title="Fixtures will be published soon" hint="Check back once the draw is announced." />;
    }
    return (
      <div className="sport-page__agenda">
        {grouped.live.length > 0 && (
          <FixtureSection title="Live" fixtures={grouped.live} sport={sport} totalRounds={totalRounds} siblings={fixtures} stateFor={stateFor} onOpen={setOpenFixture} />
        )}
        {grouped.upNext.map((day, i) => (
          <FixtureSection
            key={day.key}
            title={i === 0 ? `Up next · ${formatDate(day.date ?? undefined) ?? "Date to be announced"}` : formatDate(day.date ?? undefined) ?? "Date to be announced"}
            fixtures={day.fixtures}
            sport={sport}
            totalRounds={totalRounds}
            siblings={fixtures}
            stateFor={stateFor}
            onOpen={setOpenFixture}
          />
        ))}
        {grouped.completed.length > 0 ? (
          <FixtureSection title="Results" fixtures={grouped.completed} sport={sport} totalRounds={totalRounds} siblings={fixtures} stateFor={stateFor} onOpen={setOpenFixture} />
        ) : (
          grouped.live.length + grouped.upNextCount > 0 && (
            <section className="sport-page__section">
              <h3 className="sport-page__group-title">Results</h3>
              <EmptyState sport={sport.slug} title="No completed matches yet" />
            </section>
          )
        )}
      </div>
    );
  };

  return (
    <div className="sport-page" style={style} id="main" ref={rootRef}>
      <div className="sport-page__identity">
        <SportAtmosphere slug={sport.slug} />
        <svg className="sport-page__watermark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          {meta.icon.map((part, i) => (
            <path key={i} d={part.d} />
          ))}
        </svg>
        <div className="container sport-page__identity-inner">
          <Reveal variant="fade" onMount className="sport-page__icon">
            <SportIcon slug={sport.slug} size={30} />
          </Reveal>
          <div className="sport-page__title">
            <Reveal variant="mask" onMount>
              <h1>{sport.name}</h1>
            </Reveal>
            <p className="sport-page__facts">
              {competitions && (
                <span>
                  {competitions.length} {competitions.length === 1 ? "competition" : "competitions"}
                </span>
              )}
              {liveCount > 0 && (
                <span className="sport-page__fact-live">
                  <span className="sport-page__fact-dot" aria-hidden="true" />
                  {liveCount} live
                </span>
              )}
            </p>
            {nextLine}
          </div>
        </div>
        <nav className="container sport-page__switcher overflow-x-scroll" aria-label="Switch sport">
          {sports.map((s) => {
            const itemMeta = getSportMeta(s.slug);
            return (
              <Link
                key={s.sportId}
                to={`/sports/${s.slug}`}
                className={`sport-page__switcher-item ${s.sportId === sport.sportId ? "is-current" : ""}`}
                style={{ "--sport-accent": itemMeta.accent, "--sport-accent-soft": itemMeta.accentSoft } as CSSProperties}
                aria-current={s.sportId === sport.sportId ? "page" : undefined}
              >
                <SportIcon slug={s.slug} size={14} />
                {s.name}
              </Link>
            );
          })}
        </nav>
      </div>

      {competitionsState.error ? (
        <div className="container sport-page__loading">
          <ErrorState title="Competitions couldn't be loaded" hint="Check your connection and try again." onRetry={competitionsState.retry} />
        </div>
      ) : competitions === null ? (
        <div className="container sport-page__loading">
          <LoadingState label="Loading competitions" />
        </div>
      ) : competitions.length === 0 ? (
        <div className="container sport-page__loading">
          <EmptyState sport={sport.slug} title="Competition not available yet" hint={`${sport.name} fixtures will appear here once published.`} />
        </div>
      ) : (
        <>
          <div className="container sport-page__controls" ref={controlsRef}>
            <div className="sport-page__tabs-mobile">{competitionTabs}</div>
            <div className="sport-page__view-toggle">{viewToggle}</div>
          </div>

          <div className={`container sport-page__layout ${showAside ? "sport-page__layout--with-aside" : ""} ${hasMultipleCompetitions ? "sport-page__layout--with-rail" : ""}`}>
            {competitionRail && <div className="sport-page__rail">{competitionRail}</div>}

            <div className="sport-page__main">
              <DirectionalSwap stateKey={`${view}-${activeCompetitionId ?? ""}`} index={view === "bracket" ? 1 : 0}>
                {view === "fixtures" && renderFixtures()}
                {view === "bracket" && activeCompetitionId && (
                  <BracketView competitionId={activeCompetitionId} onOpenFixture={setOpenFixture} sport={sport} />
                )}
              </DirectionalSwap>
            </div>

            {showAside && (
              <aside className="sport-page__aside" aria-label={`${sport.name} live and next`}>
                {grouped.live.length > 0 ? (
                  <>
                    <h4 className="sport-page__group-title">Live now</h4>
                    {grouped.live.slice(0, 2).map((f) => (
                      <MatchTile key={f.fixtureId} fixture={f} onOpen={setOpenFixture} density="compact" sport={sport} totalRounds={totalRounds} siblings={fixtures} matchState={stateFor(f)} />
                    ))}
                  </>
                ) : grouped.upNext.length > 0 ? (
                  <>
                    <h4 className="sport-page__group-title">Up next</h4>
                    <MatchTile
                      fixture={grouped.upNext[0].fixtures[0]}
                      onOpen={setOpenFixture}
                      density="compact"
                      sport={sport}
                      totalRounds={totalRounds}
                      siblings={fixtures}
                      matchState={stateFor(grouped.upNext[0].fixtures[0])}
                    />
                  </>
                ) : (
                  <p className="sport-page__aside-empty">Nothing else scheduled in {sport.name} right now.</p>
                )}
              </aside>
            )}
          </div>
        </>
      )}

      <AnimatePresence>
        {openFixture && <MatchModal
            key={openFixture}
            fixtureId={openFixture}
            onClose={() => setOpenFixture(null)}
            context={activeCompetition ? { competitionId: activeCompetition.competitionId, competitionName: activeCompetition.name, totalRounds } : undefined}
          />}
      </AnimatePresence>
    </div>
  );
}
