import type { MatchStateDoc } from "../../../../shared/types";
import type { MatchConfiguration } from "../../../../shared/matchConfig";
import {
  emptyCricketState,
  target,
  runsRequired,
  ballsRemaining,
  computeResult,
  type CricketInningsState,
} from "../../../../shared/scoring/cricket-innings";
import { cricketOversFrom, cricketWicketsFrom } from "../../../../shared/scoring/fromMatchConfiguration";
import { useLiveStatePush } from "../../../hooks/useLiveStatePush";
import { ControlError } from "./ControlError";
import type { CompleteHandler } from "./types";

export function CricketControl({
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
  const state = (matchState?.data as unknown as CricketInningsState) ?? emptyCricketState(cricketOversFrom(matchConfiguration), "A");
  const { pending, error, push } = useLiveStatePush(fixtureId, matchState?.version ?? 0);
  const innings = state.currentInnings === 1 ? state.innings1 : state.innings2;
  const inningsKey = state.currentInnings === 1 ? "innings1" : "innings2";
  const battingSide = (state.currentInnings === 1) === (state.battingFirst === "A") ? "A" : "B";
  const battingLabel = battingSide === "A" ? labelA : labelB;
  const t = target(state);
  const result = computeResult(state, cricketWicketsFrom(matchConfiguration));

  const addBall = (change: { runs?: number; wicket?: boolean }) => {
    const next = {
      ...innings,
      runs: innings.runs + (change.runs ?? 0),
      wickets: innings.wickets + (change.wicket ? 1 : 0),
      ballsInOver: innings.ballsInOver + 1,
    };
    if (next.ballsInOver === 6) {
      next.ballsInOver = 0;
      next.oversCompleted += 1;
    }
    void push({ ...state, [inningsKey]: next });
  };

  return (
    <div className="control">
      <p className="control__context">
        Innings {state.currentInnings} · {battingLabel} batting · {innings.oversCompleted}.{innings.ballsInOver} of {state.oversPerInnings} overs
      </p>

      {t !== null && state.currentInnings === 2 && (
        <p className="control__chase">
          <span>Target {t}</span>
          <strong>
            Need {runsRequired(state)} off {ballsRemaining(state)} balls
          </strong>
        </p>
      )}

      <div className="control__runs" role="group" aria-label="Runs off the ball">
        {[0, 1, 2, 3, 4, 6].map((r) => (
          <button key={r} type="button" className="admin-btn admin-btn--tap" disabled={pending} onClick={() => addBall({ runs: r })}>
            {r}
          </button>
        ))}
      </div>

      <button type="button" className="admin-btn admin-btn--wicket admin-btn--block" disabled={pending} onClick={() => addBall({ wicket: true })}>
        Wicket
      </button>

      <ControlError message={error} />

      {state.currentInnings === 1 && (
        <button type="button" className="admin-btn admin-btn--block" disabled={pending} onClick={() => void push({ ...state, currentInnings: 2 })}>
          End innings 1
        </button>
      )}
      {state.currentInnings === 2 && result.winner && result.winner !== "TIE" && (
        <button
          type="button"
          className="admin-btn admin-btn--primary admin-btn--block"
          onClick={() => onComplete(result.winner === "A" ? "A" : "B", result.margin)}
        >
          Complete match · {result.winner === "A" ? labelA : labelB} wins {result.margin}
        </button>
      )}
      {state.currentInnings === 2 && result.winner === "TIE" && <p className="control__context">Match tied</p>}
    </div>
  );
}
