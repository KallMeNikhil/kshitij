import { useState } from "react";
import type { MatchStateDoc } from "../../../../shared/types";
import type { MatchConfiguration } from "../../../../shared/matchConfig";
import {
  battingFirstFromToss,
  ballsRemaining,
  computeResult,
  emptyCricketState,
  endInnings,
  hasStarted,
  isInningsOver,
  recordBall,
  runsRequired,
  target,
  type CricketExtra,
  type CricketInningsState,
  type CricketToss,
} from "../../../../shared/scoring/cricket-innings";
import { cricketOversFrom, cricketWicketsFrom } from "../../../../shared/scoring/fromMatchConfiguration";
import { useLiveStatePush } from "../../../hooks/useLiveStatePush";
import { ControlError } from "./ControlError";
import { UndoButton } from "./UndoButton";
import type { CompleteHandler } from "./types";

const EXTRAS: Array<{ value: CricketExtra; label: string }> = [
  { value: "WIDE", label: "Wide" },
  { value: "NO_BALL", label: "No-ball" },
  { value: "BYE", label: "Bye" },
  { value: "LEG_BYE", label: "Leg-bye" },
];

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
  const overs = cricketOversFrom(matchConfiguration);
  const maxWickets = cricketWicketsFrom(matchConfiguration);
  const saved = matchState?.data as unknown as CricketInningsState | undefined;
  const { pending, error, push, undo } = useLiveStatePush(fixtureId, matchState?.version ?? 0);
  const [extra, setExtra] = useState<CricketExtra | null>(null);
  const [tossWinner, setTossWinner] = useState<"A" | "B" | null>(saved?.toss?.winner ?? null);
  const label = (side: "A" | "B") => (side === "A" ? labelA : labelB);

  if (!saved || !hasStarted(saved)) {
    const chooseToss = (decision: CricketToss["decision"]) => {
      if (!tossWinner) return;
      const toss = { winner: tossWinner, decision };
      void push(emptyCricketState(overs, battingFirstFromToss(toss), toss));
    };
    return (
      <div className="control">
        <p className="control__context">
          {saved?.toss
            ? `${label(saved.toss.winner)} won the toss and chose to ${saved.toss.decision === "BAT" ? "bat" : "bowl"}. ${label(saved.battingFirst)} bat first. You can still change this before the first ball.`
            : "Record the toss before the first ball."}
        </p>
        <div className="control__toggle" role="group" aria-label="Toss won by">
          {(["A", "B"] as const).map((side) => (
            <button key={side} type="button" aria-pressed={tossWinner === side} className={`control__toggle-btn ${tossWinner === side ? "is-active" : ""}`} onClick={() => setTossWinner(side)}>
              {label(side)} won the toss
            </button>
          ))}
        </div>
        <div className="control__row">
          <button type="button" className="admin-btn" disabled={pending || !tossWinner} onClick={() => chooseToss("BAT")}>
            Chose to bat
          </button>
          <button type="button" className="admin-btn" disabled={pending || !tossWinner} onClick={() => chooseToss("BOWL")}>
            Chose to bowl
          </button>
        </div>
        {saved && <ScoringPad state={saved} {...{ pending, push, extra, setExtra, maxWickets, label }} />}
        <ControlError message={error} />
      </div>
    );
  }

  const state = saved;
  const innings = state.currentInnings === 1 ? state.innings1 : state.innings2;
  const battingSide = (state.currentInnings === 1) === (state.battingFirst === "A") ? "A" : "B";
  const t = target(state);
  const result = computeResult(state, maxWickets);
  const inningsOver = isInningsOver(innings, state.oversPerInnings, maxWickets);

  return (
    <div className="control">
      <p className="control__context">
        Innings {state.currentInnings} · {label(battingSide)} batting · {innings.runs}/{innings.wickets} · {innings.oversCompleted}.{innings.ballsInOver} of {state.oversPerInnings} overs
        {innings.extras ? ` · extras ${innings.extras}` : ""}
      </p>

      {t !== null && result.winner === null && (
        <p className="control__chase">
          <span>Target {t}</span>
          <strong>
            Need {runsRequired(state)} off {ballsRemaining(state)} balls
          </strong>
        </p>
      )}

      {result.winner === null && !inningsOver && <ScoringPad state={state} {...{ pending, push, extra, setExtra, maxWickets, label }} />}

      <UndoButton matchState={matchState} pending={pending} onUndo={undo} />
      <ControlError message={error} />

      {result.winner === null && !inningsOver && (
        <button type="button" className="admin-btn admin-btn--block" disabled={pending} onClick={() => void push(endInnings(state))}>
          {state.currentInnings === 1 ? "End innings 1 (declared or all out)" : "End innings 2"}
        </button>
      )}
      {result.winner && result.winner !== "TIE" && (
        <button type="button" className="admin-btn admin-btn--primary admin-btn--block" disabled={pending} onClick={() => onComplete(result.winner as "A" | "B", result.margin)}>
          Complete match · {label(result.winner)} won {result.margin}
        </button>
      )}
      {result.winner === "TIE" && (
        <p className="control__context">
          Match tied. Play the tie-break the organisers have set (for example a super over), then record the outcome as an organisers' decision under End match early.
        </p>
      )}
    </div>
  );
}

function ScoringPad({
  state,
  pending,
  push,
  extra,
  setExtra,
  maxWickets,
  label,
}: {
  state: CricketInningsState;
  pending: boolean;
  push: (data: object) => Promise<boolean>;
  extra: CricketExtra | null;
  setExtra: (extra: CricketExtra | null) => void;
  maxWickets: number;
  label: (side: "A" | "B") => string;
}) {
  const ball = async (runs: number, wicket = false) => {
    const next = recordBall(state, { runs, wicket, ...(extra ? { extra } : {}) }, maxWickets);
    if (next !== state && (await push(next))) setExtra(null);
  };
  const batting = (state.currentInnings === 1) === (state.battingFirst === "A") ? "A" : "B";
  const runOptions = extra === "WIDE" || extra === "BYE" || extra === "LEG_BYE" ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 6];

  return (
    <>
      <div className="control__toggle control__toggle--three" role="group" aria-label="Extra">
        {EXTRAS.map((e) => (
          <button key={e.value} type="button" aria-pressed={extra === e.value} className={`control__toggle-btn ${extra === e.value ? "is-active" : ""}`} onClick={() => setExtra(extra === e.value ? null : e.value)}>
            {e.label}
          </button>
        ))}
      </div>
      <p className="control__context">
        {extra === "WIDE" || extra === "NO_BALL"
          ? `${extra === "WIDE" ? "Wide" : "No-ball"}: 1 run is added and the ball is bowled again. Pick any extra runs.`
          : extra
            ? `${extra === "BYE" ? "Byes" : "Leg-byes"} count as extras, not ${label(batting)} batting runs.`
            : `Runs off the bat for ${label(batting)}.`}
      </p>
      <div className="control__runs" role="group" aria-label="Runs">
        {runOptions.map((r) => (
          <button key={r} type="button" className="admin-btn admin-btn--tap" disabled={pending} onClick={() => void ball(r)}>
            {r}
          </button>
        ))}
      </div>
      {extra !== "WIDE" && extra !== "NO_BALL" && (
        <button type="button" className="admin-btn admin-btn--wicket admin-btn--block" disabled={pending} onClick={() => void ball(0, true)}>
          Wicket
        </button>
      )}
    </>
  );
}
