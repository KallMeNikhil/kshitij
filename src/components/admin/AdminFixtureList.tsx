import { useMemo } from "react";
import { MatchTile } from "../MatchTile";
import { useMatchStates } from "../../hooks/useFirestoreData";
import type { CompetitionDoc, FixtureDoc, SportDoc } from "../../../shared/types";

export function AdminFixtureList({
  fixtures,
  sports,
  competitions,
  roundTotals,
  showSport,
  onOpen,
  renderExtra,
  emptyText,
}: {
  fixtures: FixtureDoc[];
  sports: SportDoc[] | null;
  competitions: CompetitionDoc[] | null;
  roundTotals: ReadonlyMap<string, number>;
  showSport: boolean;
  onOpen: (fixtureId: string) => void;
  renderExtra?: (fixture: FixtureDoc) => React.ReactNode;
  emptyText: string;
}) {
  const ids = useMemo(
    () =>
      fixtures
        .filter((f) => f.status === "LIVE" || f.status === "COMPLETED")
        .map((f) => f.fixtureId)
        .sort(),
    [fixtures]
  );
  const states = useMatchStates(ids);

  if (fixtures.length === 0) return <p className="admin-empty">{emptyText}</p>;

  return (
    <div className="admin-fixture-list">
      {fixtures.map((f) => {
        const sport = sports?.find((s) => s.sportId === f.sportId);
        const total = roundTotals.get(f.competitionId);
        const needsState = f.status === "LIVE" || f.status === "COMPLETED";
        return (
          <div key={f.fixtureId} className="admin-fixture-list__item">
            <MatchTile
              fixture={f}
              density="row"
              showSport={showSport}
              sportName={sport?.name}
              sport={sport}
              competitionName={competitions?.find((c) => c.competitionId === f.competitionId)?.name}
              totalRounds={total && total > 0 ? total : undefined}
              matchState={needsState ? (states ? states.get(f.fixtureId) ?? null : undefined) : null}
              onOpen={onOpen}
            />
            {renderExtra?.(f)}
          </div>
        );
      })}
    </div>
  );
}
