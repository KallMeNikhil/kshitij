import { useMemo } from "react";
import { SectionHeading } from "./SectionHeading";
import { MatchTile } from "../MatchTile";
import { useMatchStates } from "../../hooks/useFirestoreData";
import { isByeFixture } from "../../lib/matchLabels";
import { ErrorState } from "../states/StateViews";
import type { CompetitionDoc, FixtureDoc, SportDoc } from "../../../shared/types";

export function ResultsSection({
  results,
  sports,
  competitions,
  roundTotals,
  error,
  onRetry,
  onOpen,
}: {
  results: FixtureDoc[] | null;
  sports: SportDoc[] | null;
  competitions: CompetitionDoc[] | null;
  roundTotals: ReadonlyMap<string, number>;
  error: boolean;
  onRetry: () => void;
  onOpen: (id: string) => void;
}) {
  const played = useMemo(() => (results ?? []).filter((f) => !isByeFixture(f)), [results]);
  const ids = useMemo(() => played.map((f) => f.fixtureId).sort(), [played]);
  const states = useMatchStates(ids);

  if (error) {
    return (
      <section className="home-section" id="results">
        <div className="container">
          <SectionHeading title="Results" />
          <ErrorState title="Results couldn't be loaded" hint="Check your connection and try again." onRetry={onRetry} />
        </div>
      </section>
    );
  }

  if (!results || played.length === 0) return null;

  return (
    <section className="home-section" id="results">
      <div className="container">
        <SectionHeading title="Results" lead="Recently completed matches." />
        <div className="results-list">
          {played.map((f) => {
            const sport = sports?.find((s) => s.sportId === f.sportId);
            const total = roundTotals.get(f.competitionId);
            return (
              <MatchTile
                key={f.fixtureId}
                fixture={f}
                onOpen={onOpen}
                density="result"
                showSport
                sportName={sport?.name}
                sport={sport}
                competitionName={competitions?.find((c) => c.competitionId === f.competitionId)?.name}
                totalRounds={total && total > 0 ? total : undefined}
                matchState={states ? states.get(f.fixtureId) ?? null : undefined}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
