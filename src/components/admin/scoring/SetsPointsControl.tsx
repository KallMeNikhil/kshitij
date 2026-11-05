import { useState } from "react";
import type { MatchStateDoc } from "../../../../shared/types";
import type { MatchConfiguration } from "../../../../shared/matchConfig";
import {
  emptySetsPointsState,
  incrementPoint,
  correctPoint,
  matchWinner,
  setsSummary,
  type SetsPointsState,
} from "../../../../shared/scoring/sets-points";
import { setsPointsConfigFrom } from "../../../../shared/scoring/fromMatchConfiguration";
import { useLiveStatePush } from "../../../hooks/useLiveStatePush";
import { ControlError } from "./ControlError";
import type { CompleteHandler } from "./types";

export function SetsPointsControl({
  fixtureId,
  sportId,
  labelA,
  labelB,
  matchState,
  matchConfiguration,
  onComplete,
}: {
  fixtureId: string;
  sportId: string;
  labelA: string;
  labelB: string;
  matchState: MatchStateDoc | null;
  matchConfiguration?: MatchConfiguration | null;
  onComplete: CompleteHandler;
}) {
  const config = setsPointsConfigFrom(matchConfiguration, sportId);
  const state = (matchState?.data as unknown as SetsPointsState) ?? emptySetsPointsState();
  const { pending, error, push } = useLiveStatePush(fixtureId, matchState?.version ?? 0);
  const [correctionNote, setCorrectionNote] = useState<string | null>(null);
  const winner = matchWinner(state, config);
  const current = state.sets[state.currentSet];
  const completed = state.sets.filter((s) => s.completed);
  const setsWonA = completed.filter((s) => s.a > s.b).length;
  const setsWonB = completed.filter((s) => s.b > s.a).length;
  const shownSets = state.sets.slice(0, state.currentSet + 1);

  return (
    <div className="control">
      <p className="control__context">
        Set {state.currentSet + 1} of {config.bestOf} · sets won {setsWonA}–{setsWonB}
      </p>

      <div className="control__sets" role="table" aria-label="Set history">
        <div className="control__sets-row control__sets-row--head" role="row">
          <span role="columnheader">Set</span>
          <span role="columnheader" className="control__sets-name">{labelA}</span>
          <span role="columnheader" className="control__sets-name">{labelB}</span>
        </div>
        {shownSets.map((set, i) => (
          <div key={i} className={`control__sets-row ${set.completed ? "is-done" : "is-current"}`} role="row">
            <span role="cell">{set.completed ? `${i + 1} ✓` : `${i + 1}`}</span>
            <span role="cell" className={set.completed && set.a > set.b ? "is-won" : ""}>{set.a}</span>
            <span role="cell" className={set.completed && set.b > set.a ? "is-won" : ""}>{set.b}</span>
          </div>
        ))}
      </div>

      <div className="control__pair">
        {([["A", labelA, current.a], ["B", labelB, current.b]] as const).map(([side, label, points]) => (
          <button
            key={side}
            type="button"
            className="control__tap"
            disabled={pending || current.completed}
            onClick={() => void push(incrementPoint(state, side, config))}
            aria-label={`Add a point for ${label}. Current ${points}`}
          >
            <span className="control__tap-name">{label}</span>
            <span className="control__tap-score">{points}</span>
            <span className="control__tap-hint">+1 point</span>
          </button>
        ))}
      </div>

      <div className="control__row control__row--secondary">
        <button type="button" className="admin-btn" disabled={pending} onClick={() => void push(correctPoint(state, "A", -1))}>
          −1 <span className="control__btn-name">{labelA}</span>
        </button>
        <button type="button" className="admin-btn" disabled={pending} onClick={() => void push(correctPoint(state, "B", -1))}>
          −1 <span className="control__btn-name">{labelB}</span>
        </button>
      </div>

      {completed.length > 0 && (
        <details className="control__earlier">
          <summary>Correct an earlier set</summary>
          {state.sets.map((set, i) =>
            set.completed && i !== state.currentSet ? (
              <div key={i} className="control__row control__row--secondary">
                <span>Set {i + 1}</span>
                {(["A", "B"] as const).flatMap((side) =>
                  ([-1, 1] as const).map((delta) => (
                    <button
                      key={`${side}${delta}`}
                      type="button"
                      className="admin-btn"
                      disabled={pending}
                      onClick={() => {
                        const next = correctPoint(state, side, delta, config, i);
                        if (next === state) {
                          setCorrectionNote("That correction would change who won the set.");
                          return;
                        }
                        setCorrectionNote(null);
                        void push(next);
                      }}
                    >
                      {delta > 0 ? "+1" : "−1"} <span className="control__btn-name">{side === "A" ? labelA : labelB}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null
          )}
          {correctionNote && <p className="admin-hint" role="status">{correctionNote}</p>}
        </details>
      )}

      <ControlError message={error} />

      {winner && (
        <button type="button" className="admin-btn admin-btn--primary admin-btn--block" onClick={() => onComplete(winner, setsSummary(state))}>
          Complete match · {winner === "A" ? labelA : labelB} wins
        </button>
      )}
    </div>
  );
}
