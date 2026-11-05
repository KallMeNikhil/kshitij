import { useState } from "react";
import type { MatchStateDoc } from "../../../../shared/types";
import type { MatchConfiguration } from "../../../../shared/matchConfig";
import {
  RESULT_METHODS,
  addBoard,
  boardsSummary,
  boardsWon,
  emptyResultOnlyState,
  removeLastBoard,
  resultWinner,
  setOutcome,
  setTieBreakWinner,
  type ResultOnlyState,
} from "../../../../shared/scoring/result-only";
import { resultOnlyRulesFrom } from "../../../../shared/scoring/fromMatchConfiguration";
import { useLiveStatePush } from "../../../hooks/useLiveStatePush";
import { ControlError } from "./ControlError";
import type { CompleteHandler } from "./types";

export function ResultOnlyControl({
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
  const rules = resultOnlyRulesFrom(matchConfiguration, sportId);
  const state = (matchState?.data as unknown as ResultOnlyState) ?? emptyResultOnlyState();
  const { pending, error, push } = useLiveStatePush(fixtureId, matchState?.version ?? 0);
  const label = (side: "A" | "B") => (side === "A" ? labelA : labelB);

  if (rules.boards) return <BoardsControl {...{ state, rules, pending, error, push, label, onComplete }} />;

  const winner = resultWinner(state);
  const summary = [state.outcome === "DRAW" ? "Drawn, won on tie-break" : "", state.method ?? ""].filter(Boolean).join(" · ");

  return (
    <div className="control">
      <p className="control__context">Record the result of the game.</p>
      <div className="control__toggle control__toggle--three" role="group" aria-label="Result">
        {(["A", "B"] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-pressed={state.outcome === side}
            className={`control__toggle-btn ${state.outcome === side ? "is-active" : ""}`}
            disabled={pending}
            onClick={() => void push(setOutcome(state, side, state.method))}
          >
            {label(side)} won
          </button>
        ))}
        {rules.drawAllowed && (
          <button
            type="button"
            aria-pressed={state.outcome === "DRAW"}
            className={`control__toggle-btn ${state.outcome === "DRAW" ? "is-active" : ""}`}
            disabled={pending}
            onClick={() => void push(setOutcome(state, "DRAW"))}
          >
            Draw
          </button>
        )}
      </div>

      {state.outcome && (
        <label className="admin-field">
          <span className="admin-field__label">How it ended (optional)</span>
          <select
            className="admin-input"
            value={state.method ?? ""}
            disabled={pending}
            onChange={(e) => {
              const { method: _old, ...rest } = state;
              void push(e.target.value ? { ...rest, method: e.target.value } : rest);
            }}
          >
            <option value="">Not recorded</option>
            {RESULT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}

      {state.outcome === "DRAW" && (
        <>
          <p className="control__context">A knockout game needs a winner. {rules.tieBreak ? `Play the ${rules.tieBreak.toLowerCase()} and` : "Play the tie-break and"} record who won it.</p>
          <div className="control__pair">
            {(["A", "B"] as const).map((side) => (
              <button
                key={side}
                type="button"
                aria-pressed={state.tieBreakWinner === side}
                className={`control__tap control__tap--short ${state.tieBreakWinner === side ? "is-selected" : ""}`}
                disabled={pending}
                onClick={() => void push(setTieBreakWinner(state, side))}
              >
                <span className="control__tap-name">{label(side)}</span>
                <span className="control__tap-hint">Won the tie-break</span>
              </button>
            ))}
          </div>
        </>
      )}

      <ControlError message={error} />

      {winner && (
        <button type="button" className="admin-btn admin-btn--primary admin-btn--block" disabled={pending} onClick={() => onComplete(winner, summary)}>
          Complete match · {label(winner)} wins
        </button>
      )}
    </div>
  );
}

function BoardsControl({
  state,
  rules,
  pending,
  error,
  push,
  label,
  onComplete,
}: {
  state: ResultOnlyState;
  rules: ReturnType<typeof resultOnlyRulesFrom>;
  pending: boolean;
  error: string;
  push: (data: object) => Promise<boolean>;
  label: (side: "A" | "B") => string;
  onComplete: CompleteHandler;
}) {
  const [pointsA, setPointsA] = useState("");
  const [pointsB, setPointsB] = useState("");
  const boards = state.boards ?? [];
  const won = boardsWon(state);
  const winner = state.outcome === "A" || state.outcome === "B" ? state.outcome : null;
  const a = Number(pointsA);
  const b = Number(pointsB);
  const valid = pointsA !== "" && pointsB !== "" && Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0;

  const save = async () => {
    if (!valid) return;
    if (await push(addBoard(state, { a, b }, rules.bestOfBoards))) {
      setPointsA("");
      setPointsB("");
    }
  };

  return (
    <div className="control">
      <p className="control__context">
        Best of {rules.bestOfBoards} boards · boards won {won.a}–{won.b}. A level board does not count; play another.
      </p>
      {boards.length > 0 && (
        <div className="control__sets" role="table" aria-label="Boards">
          <div className="control__sets-row control__sets-row--head" role="row">
            <span role="columnheader">Board</span>
            <span role="columnheader" className="control__sets-name">{label("A")}</span>
            <span role="columnheader" className="control__sets-name">{label("B")}</span>
          </div>
          {boards.map((x, i) => (
            <div key={i} className="control__sets-row is-done" role="row">
              <span role="cell">{i + 1}</span>
              <span role="cell" className={x.a > x.b ? "is-won" : ""}>{x.a}</span>
              <span role="cell" className={x.b > x.a ? "is-won" : ""}>{x.b}</span>
            </div>
          ))}
        </div>
      )}
      {!winner && (
        <>
          <div className="control__pair control__pair--inputs">
            <label className="admin-field">
              <span className="admin-field__label">{label("A")} points</span>
              <input className="admin-input" type="number" inputMode="numeric" min={0} value={pointsA} onChange={(e) => setPointsA(e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field__label">{label("B")} points</span>
              <input className="admin-input" type="number" inputMode="numeric" min={0} value={pointsB} onChange={(e) => setPointsB(e.target.value)} />
            </label>
          </div>
          <button type="button" className="admin-btn admin-btn--block" disabled={pending || !valid} onClick={() => void save()}>
            Save board {boards.length + 1}
          </button>
        </>
      )}
      {boards.length > 0 && (
        <button type="button" className="admin-btn admin-btn--block" disabled={pending} onClick={() => void push(removeLastBoard(state, rules.bestOfBoards))}>
          Remove last board
        </button>
      )}
      <ControlError message={error} />
      {winner && (
        <button type="button" className="admin-btn admin-btn--primary admin-btn--block" disabled={pending} onClick={() => onComplete(winner, boardsSummary(state))}>
          Complete match · {label(winner)} wins
        </button>
      )}
    </div>
  );
}
