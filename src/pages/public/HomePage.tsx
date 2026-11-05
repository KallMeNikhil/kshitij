import { useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { usePublishedCompetitionsState, useRecentCompletedState, useRoundTotals, useUpcomingFixturesState } from "../../hooks/useFirestoreData";
import { useHomeSections, usePublicLive, usePublicLiveError, usePublicLiveStates, usePublicRetry, usePublicSiteContent, usePublicSports, usePublicSportsStatus } from "../../lib/PublicDataContext";
import { MatchModal } from "../../components/MatchModal";
import { IntroSplash } from "../../components/kshitij/IntroSplash";
import { KshitijHero } from "../../components/kshitij/KshitijHero";
import { EventRibbon } from "../../components/kshitij/EventRibbon";
import { LiveBand } from "../../components/kshitij/LiveBand";
import { SportsMatrix } from "../../components/kshitij/SportsMatrix";
import { ResultsSection } from "../../components/kshitij/ResultsSection";
import { Gallery } from "../../components/kshitij/Gallery";
import { Committee } from "../../components/kshitij/Committee";
import { SectionHeading } from "../../components/kshitij/SectionHeading";
import { ErrorState, LoadingState } from "../../components/states/StateViews";

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function HomePage() {
  const sports = usePublicSports();
  const liveFixtures = usePublicLive();
  const sportsStatus = usePublicSportsStatus();
  const liveError = usePublicLiveError();
  const liveStates = usePublicLiveStates();
  const retryPublic = usePublicRetry();
  const upcomingState = useUpcomingFixturesState(8);
  const competitionsState = usePublishedCompetitionsState();
  const resultsState = useRecentCompletedState(6);
  const upcomingFixtures = upcomingState.data;
  const competitions = competitionsState.data;
  const results = resultsState.data;
  const scheduleError = liveError || upcomingState.error;
  const roundTotals = useRoundTotals(
    useMemo(() => [...(liveFixtures ?? []), ...(upcomingFixtures ?? []), ...(results ?? [])].map((f) => f.competitionId), [liveFixtures, upcomingFixtures, results])
  );
  const { setHomeSections } = useHomeSections();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const openFixture = searchParams.get("match");

  const liveCount = liveFixtures?.length ?? 0;
  const hasLiveBand = liveCount > 0 || (upcomingFixtures?.length ?? 0) > 0;
  const showScheduleError = scheduleError && !hasLiveBand;
  const showEmptyBand = !hasLiveBand && !scheduleError && liveFixtures !== null && upcomingFixtures !== null;
  const showBand = hasLiveBand || showEmptyBand;
  const hasSports = (sports?.length ?? 0) > 0;
  const hasResults = (results?.length ?? 0) > 0 || resultsState.error;
  const siteView = usePublicSiteContent();
  const galleryItems = siteView.gallery ?? [];
  const committeeMembers = siteView.committee ?? [];
  const hasGallery = galleryItems.length > 0;
  const hasCommittee = committeeMembers.length > 0;

  const order = useMemo(
    () =>
      [
        (showBand || showScheduleError) && "live-now",
        (hasSports || sports === null || sportsStatus.error) && "sports",
        hasResults && "results",
        hasGallery && "gallery",
        hasCommittee && "committee",
      ].filter((v): v is string => typeof v === "string"),
    [showBand, showScheduleError, hasSports, sports, sportsStatus.error, hasResults, hasGallery, hasCommittee]
  );

  const sectionKey = order.filter((id) => id === "live-now" || id === "sports" || id === "results").join("|");
  useEffect(() => {
    setHomeSections(new Set(sectionKey ? sectionKey.split("|") : []));
    return () => setHomeSections(new Set());
  }, [sectionKey, setHomeSections]);

  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const timer = window.setTimeout(() => scrollToId(id), 120);
    return () => window.clearTimeout(timer);
  }, [location.hash, sectionKey]);

  const setOpenFixture = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("match", id);
    else next.delete("match");
    setSearchParams(next);
  };

  const firstSport = sports?.[0] ?? null;
  const primary = liveCount > 0 ? { label: "Live now", onClick: () => scrollToId("live-now") } : { label: "Explore sports", onClick: () => scrollToId("sports") };
  const secondary =
    liveCount > 0
      ? { label: "All sports", onClick: () => scrollToId("sports") }
      : hasLiveBand
        ? { label: "Up next", onClick: () => scrollToId("live-now") }
        : resultsState.data && resultsState.data.length > 0
          ? { label: "Results", onClick: () => scrollToId("results") }
          : firstSport
            ? { label: `${firstSport.name} fixtures`, onClick: () => navigate(`/sports/${firstSport.slug}`) }
            : null;

  return (
    <div className="home-page" id="main">
      <IntroSplash />
      <KshitijHero primary={primary} secondary={secondary} />

      <EventRibbon />

      {showBand && (
        <>
          <hr className="pane-seam" />
          <LiveBand
           
            liveFixtures={liveFixtures}
            liveStates={liveStates}
            upcomingFixtures={upcomingFixtures}
            sports={sports}
            competitions={competitions}
            roundTotals={roundTotals}
            onOpen={setOpenFixture}
          />
        </>
      )}

      {showScheduleError && (
        <>
          <hr className="pane-seam" />
          <section className="home-section" id="live-now">
            <div className="container">
              <SectionHeading title="Live now" />
              <ErrorState title="Live matches couldn't be loaded" hint="Check your connection and try again." onRetry={() => { retryPublic(); upcomingState.retry(); }} />
            </div>
          </section>
        </>
      )}

      {sports === null ? (
        <>
          <hr className="pane-seam" />
          <section className="home-section" id="sports">
            <div className="container">
              <SectionHeading title="The sports" />
              <LoadingState label="Loading sports" rows={3} />
            </div>
          </section>
        </>
      ) : sportsStatus.error ? (
        <>
          <hr className="pane-seam" />
          <section className="home-section" id="sports">
            <div className="container">
              <SectionHeading title="The sports" />
              <ErrorState title="Sports couldn't be loaded" hint="Check your connection and try again." onRetry={sportsStatus.retry} />
            </div>
          </section>
        </>
      ) : (
        hasSports && (
          <>
            <hr className="pane-seam" />
            <SportsMatrix sports={sports} liveFixtures={liveFixtures} upcomingFixtures={upcomingFixtures} />
          </>
        )
      )}

      {hasResults && (
        <>
          <hr className="pane-seam" />
          <ResultsSection results={results} sports={sports} competitions={competitions} roundTotals={roundTotals} error={resultsState.error} onRetry={resultsState.retry} onOpen={setOpenFixture} />
        </>
      )}

      {hasGallery && (
        <>
          <hr className="pane-seam" />
          <Gallery items={galleryItems} />
        </>
      )}

      {hasCommittee && (
        <>
          <hr className="pane-seam" />
          <Committee members={committeeMembers} />
        </>
      )}

      <AnimatePresence>
        {openFixture && <MatchModal key={openFixture} fixtureId={openFixture} onClose={() => setOpenFixture(null)} />}
      </AnimatePresence>
    </div>
  );
}
