import type { MatchStateDoc } from "../../../../shared/types";
import type { MatchConfiguration } from "../../../../shared/matchConfig";
import {
  emptyBasketballState,
  addPoints,
  correctPoints,
  setPeriod,
  periodName,
  periodScores,
  canEndMatch,
  endMatch,
  resumeMatch,
  type BasketballState,
} from "../../../../shared/scoring/basketball-points";
import { basketballConfigFrom } from "../../../../shared/scoring/fromMatchConfiguration";
import { useLiveStatePush } from "../../../hooks/useLiveStatePush";
import { ControlError } from "./ControlError";
import { UndoButton } from "./UndoButton";
import type { CompleteHandler } from "./types";

export function BasketballControl({
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
  const config = basketballConfigFrom(matchConfiguration);
  const state = (matchState?.data as unknown as BasketballState) ?? emptyBasketballState();
  const { pending, error, push, undo } = useLiveStatePush(fixtureId, matchState?.version ?? 0);
  const ended = state.ended === true;
  const level = state.period >= config.quarters && state.scoreA === state.scoreB;
  const winner = ended && state.scoreA !== state.scoreB ? (state.scoreA > state.scoreB ? "A" : "B") : null;
  const completed = periodScores(state);
  const maxShown = Math.max(state.period, config.quarters);
  const periods = Array.from({ length: maxShown }, (_, i) => i + 1);

  return (
    <div className="control">
      <div className="control__periods" role="group" aria-label="Period">
        {periods.map((p) => (
          <button
            key={p}
            type="button"
            className={`control__period-btn ${p === state.period ? "is-active" : ""} ${p < state.period ? "is-done" : ""}`}
            aria-pressed={p === state.period}
            disabled={pending || ended || p > state.period + 1}
            onClick={() => void push(setPeriod(state, p, config))}
          >
            {periodName(p, config)}
          </button>
        ))}
        <button type="button" className="control__period-btn" disabled={pending || ended} onClick={() => void push(setPeriod(state, state.period + 1, config))}>
          {state.period >= config.quarters ? "Add overtime" : "Next"}
        </button>
      </div>

      {completed.length > 0 && (
        <ul className="control__period-scores" aria-label="Completed periods">
          {completed.map((c) => (
            <li key={c.period}>
              <span>{periodName(c.period, config)}</span>
              <span>
                {c.a} – {c.b}
              </span>
            </li>
          ))}
        </ul>
      )}

      {(["A", "B"] as const).map((side) => (
        <div key={side} className="control__side">
          <div className="control__side-head">
            <span className="control__side-name">{side === "A" ? labelA : labelB}</span>
            <span className="control__side-score">{side === "A" ? state.scoreA : state.scoreB}</span>
          </div>
          <div className="control__quad">
            {[1, 2, 3].map((pts) => (
              <button key={pts} type="button" className="admin-btn admin-btn--tap" disabled={pending || ended} onClick={() => void push(addPoints(state, side, pts as 1 | 2 | 3))}>
                +{pts}
              </button>
            ))}
            <button type="button" className="admin-btn admin-btn--tap" disabled={pending || ended} onClick={() => void push(correctPoints(state, side, -1))} aria-label={`Remove one point from ${side === "A" ? labelA : labelB}`}>
              −1
            </button>
          </div>
        </div>
      ))}

      <UndoButton matchState={matchState} pending={pending} onUndo={undo} />
      <ControlError message={error} />

      {!ended && canEndMatch(state, config) && (
        <button type="button" className="admin-btn admin-btn--block" disabled={pending} onClick={() => void push(endMatch(state, config))}>
          End match at {state.scoreA}-{state.scoreB}
        </button>
      )}

      {ended && (
        <button type="button" className="admin-btn admin-btn--block" disabled={pending} onClick={() => void push(resumeMatch(state))}>
          Resume scoring
        </button>
      )}

      {winner && (
        <button type="button" className="admin-btn admin-btn--primary admin-btn--block" onClick={() => onComplete(winner, `${state.scoreA}-${state.scoreB}`)}>
          Complete match · {winner === "A" ? labelA : labelB} wins {state.scoreA}-{state.scoreB}
        </button>
      )}
      {!ended && level && <p className="control__context">Scores are level at the end of regulation. Add overtime to decide a winner.</p>}
      {!ended && state.period < config.quarters && <p className="control__context">Complete becomes available once the final period is ended.</p>}
    </div>
  );
}
