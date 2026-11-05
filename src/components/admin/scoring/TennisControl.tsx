import type { MatchStateDoc } from "../../../../shared/types";
import type { MatchConfiguration } from "../../../../shared/matchConfig";
import { emptyTennisState, winPoint, matchWinner, tennisSummary, type TennisState } from "../../../../shared/scoring/tennis-sets-games";
import { tennisBestOfSetsFrom, tennisRulesFrom } from "../../../../shared/scoring/fromMatchConfiguration";
import { useLiveStatePush } from "../../../hooks/useLiveStatePush";
import { ControlError } from "./ControlError";
import { UndoButton } from "./UndoButton";
import type { CompleteHandler } from "./types";

export function TennisControl({
  fixtureId,
  labelA,
  labelB,
  matchState,
  matchConfiguration,
  onComplete,
}: {
  fixtureId: string;
  labelA: string;
  labelB: string;
  matchState: MatchStateDoc | null;
  matchConfiguration?: MatchConfiguration | null;
  onComplete: CompleteHandler;
}) {
  const rules = tennisRulesFrom(matchConfiguration);
  const state = (matchState?.data as unknown as TennisState) ?? emptyTennisState(tennisBestOfSetsFrom(matchConfiguration), rules);
  const { pending, error, push, undo } = useLiveStatePush(fixtureId, matchState?.version ?? 0);
  const winner = matchWinner(state);

  return (
    <div className="control">
      <div className="control__sets" role="table" aria-label="Sets">
        <div className="control__sets-row control__sets-row--head" role="row">
          <span role="columnheader">Set</span>
          <span role="columnheader" className="control__sets-name">{labelA}</span>
          <span role="columnheader" className="control__sets-name">{labelB}</span>
        </div>
        {state.sets.map((s, i) => (
          <div key={i} className={`control__sets-row ${s.completed ? "" : "is-current"}`} role="row">
            <span role="cell">{i + 1}</span>
            <span role="cell">{s.gamesA}</span>
            <span role="cell">{s.gamesB}</span>
          </div>
        ))}
      </div>

      <p className="control__context">
        {state.tiebreak
          ? `${state.tiebreak.super ? "Match tie-break" : "Tie-break"} · ${state.tiebreak.a} – ${state.tiebreak.b}`
          : `Current game · ${state.currentGame.pointsA} – ${state.currentGame.pointsB}`}
      </p>

      <div className="control__pair">
        {(["A", "B"] as const).map((side) => (
          <button
            key={side}
            type="button"
            className="control__tap control__tap--short"
            disabled={pending || !!winner}
            onClick={() => void push(winPoint(state, side, rules))}
          >
            <span className="control__tap-name">{side === "A" ? labelA : labelB}</span>
            <span className="control__tap-hint">Won the point</span>
          </button>
        ))}
      </div>

      <UndoButton matchState={matchState} pending={pending} onUndo={undo} />
      <ControlError message={error} />

      {winner && (
        <button type="button" className="admin-btn admin-btn--primary admin-btn--block" onClick={() => onComplete(winner, tennisSummary(state))}>
          Complete match · {winner === "A" ? labelA : labelB} wins
        </button>
      )}
    </div>
  );
}
