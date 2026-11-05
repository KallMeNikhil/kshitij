import type { MatchStateDoc } from "../../../../shared/types";
import type { MatchConfiguration } from "../../../../shared/matchConfig";
import {
  emptyBasketballState,
  addPoints,
  correctPoints,
  setPeriod,
  periodName,
  periodScores,
  decideWinner,
  type BasketballState,
} from "../../../../shared/scoring/basketball-points";
import { basketballConfigFrom } from "../../../../shared/scoring/fromMatchConfiguration";
import { useLiveStatePush } from "../../../hooks/useLiveStatePush";
import { ControlError } from "./ControlError";
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
  const { pending, error, push } = useLiveStatePush(fixtureId, matchState?.version ?? 0);
  const winner = state.scoreA !== state.scoreB ? decideWinner(state) : null;
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
            disabled={pending || p > state.period + 1}
            onClick={() => void push(setPeriod(state, p, config))}
          >
            {periodName(p, config)}
          </button>
        ))}
        <button type="button" className="control__period-btn" disabled={pending} onClick={() => void push(setPeriod(state, state.period + 1, config))}>
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
              <button key={pts} type="button" className="admin-btn admin-btn--tap" disabled={pending} onClick={() => void push(addPoints(state, side, pts as 1 | 2 | 3))}>
                +{pts}
              </button>
            ))}
            <button type="button" className="admin-btn admin-btn--tap" disabled={pending} onClick={() => void push(correctPoints(state, side, -1))} aria-label={`Remove one point from ${side === "A" ? labelA : labelB}`}>
              −1
            </button>
          </div>
        </div>
      ))}

      <ControlError message={error} />

      {winner && (
        <button type="button" className="admin-btn admin-btn--primary admin-btn--block" onClick={() => onComplete(winner, `${state.scoreA}-${state.scoreB}`)}>
          Complete match · {winner === "A" ? labelA : labelB} wins {state.scoreA}-{state.scoreB}
        </button>
      )}
      {!winner && state.scoreA === state.scoreB && state.scoreA > 0 && <p className="control__context">Scores are level. Add overtime or score to decide a winner.</p>}
    </div>
  );
}
