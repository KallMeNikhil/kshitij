import { useState } from "react";
import type { MatchStateDoc, TeamDoc } from "../../../../shared/types";
import {
  emptyFootballState,
  addEvent,
  removeEvent,
  score,
  decideWinner,
  UNKNOWN_PLAYER,
  type FootballState,
  type FootballEventType,
} from "../../../../shared/scoring/football-events";
import { useLiveStatePush } from "../../../hooks/useLiveStatePush";
import { useTeamRoster } from "../../../hooks/useEntity";
import { ControlError } from "./ControlError";
import { CardIcon, GoalIcon } from "./EventIcons";
import { UndoButton } from "./UndoButton";
import { penaltiesOnDrawFrom } from "../../../../shared/scoring/fromMatchConfiguration";
import type { MatchConfiguration } from "../../../../shared/matchConfig";
import type { CompleteHandler } from "./types";

const EVENT_LABEL: Record<FootballEventType, string> = {
  GOAL: "Goal",
  PENALTY_GOAL: "Penalty goal",
  OWN_GOAL: "Own goal",
  YELLOW_CARD: "Yellow card",
  RED_CARD: "Red card",
};

function EventIcon({ type }: { type: FootballEventType }) {
  if (type === "GOAL" || type === "PENALTY_GOAL" || type === "OWN_GOAL") return <GoalIcon />;
  return <CardIcon tone={type === "YELLOW_CARD" ? "yellow" : "red"} />;
}

export function FootballControl({
  fixtureId,
  labelA,
  labelB,
  matchState,
  onComplete,
  teamA,
  teamB,
  matchConfiguration,
}: {
  fixtureId: string;
  labelA: string;
  labelB: string;
  matchState: MatchStateDoc | null;
  onComplete: CompleteHandler;
  teamA?: TeamDoc;
  teamB?: TeamDoc;
  matchConfiguration?: MatchConfiguration | null;
}) {
  const rosterA = useTeamRoster(teamA?.teamId);
  const rosterB = useTeamRoster(teamB?.teamId);
  const [side, setSide] = useState<"A" | "B">("A");
  const [eventType, setEventType] = useState<FootballEventType>("GOAL");
  const [minute, setMinute] = useState("");
  const [penA, setPenA] = useState("");
  const [penB, setPenB] = useState("");
  const state = (matchState?.data as unknown as FootballState) ?? emptyFootballState();
  const { pending, error, push, undo } = useLiveStatePush(fixtureId, matchState?.version ?? 0);
  const ended = state.ended === true;
  const penaltiesOnDraw = penaltiesOnDrawFrom(matchConfiguration);
  const s = score(state);
  const roster = side === "A" ? rosterA : rosterB;
  const winner = decideWinner(state);
  const playerName = (id?: string) => (id === UNKNOWN_PLAYER ? "Unknown player" : [...rosterA, ...rosterB].find((p) => p.participantId === id)?.name);

  const record = async (playerId: string) => {
    const next = addEvent(state, { id: `${Date.now()}`, type: eventType, side, playerId, minute: Number(minute) || 0 });
    if (await push(next)) setMinute("");
  };

  const pa = Number(penA);
  const pb = Number(penB);
  const penaltiesValid = penA !== "" && penB !== "" && Number.isInteger(pa) && Number.isInteger(pb) && pa >= 0 && pb >= 0 && pa !== pb;

  return (
    <div className="control">
      <div className="control__toggle" role="group" aria-label="Team">
        {(["A", "B"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={side === k} className={`control__toggle-btn ${side === k ? "is-active" : ""}`} onClick={() => setSide(k)}>
            {k === "A" ? labelA : labelB}
          </button>
        ))}
      </div>

      <div className="control__toggle control__toggle--three" role="group" aria-label="Event type">
        {(["GOAL", "PENALTY_GOAL", "OWN_GOAL", "YELLOW_CARD", "RED_CARD"] as const).map((t) => (
          <button key={t} type="button" aria-pressed={eventType === t} className={`control__toggle-btn ${eventType === t ? "is-active" : ""}`} onClick={() => setEventType(t)}>
            <EventIcon type={t} />
            <span>{EVENT_LABEL[t]}</span>
          </button>
        ))}
      </div>

      <label className="admin-field">
        <span className="admin-field__label">Minute</span>
        <input className="admin-input" type="number" inputMode="numeric" min={0} value={minute} onChange={(e) => setMinute(e.target.value)} placeholder="Enter the minute, then pick the player" />
      </label>

      <div className="control__roster" role="group" aria-label={`${side === "A" ? labelA : labelB} players`}>
        {roster.length === 0 && <p className="control__context">No players on this roster. Use Unknown player.</p>}
        {roster.map((p) => (
          <button key={p.participantId} type="button" className="admin-btn" disabled={pending || ended || !minute} onClick={() => void record(p.participantId)}>
            {p.name}
          </button>
        ))}
        <button type="button" className="admin-btn" disabled={pending || ended || !minute} onClick={() => void record(UNKNOWN_PLAYER)}>
          Unknown player
        </button>
      </div>

      <UndoButton matchState={matchState} pending={pending} onUndo={undo} />
      <ControlError message={error} />

      <button type="button" className="admin-btn admin-btn--block" disabled={pending} onClick={() => void push({ ...state, ended: !ended })}>
        {ended ? "Resume play" : "End of match (full time)"}
      </button>

      {state.events.length > 0 && (
        <ul className="control__events" aria-label="Match events">
          {state.events
            .slice()
            .sort((x, y) => y.minute - x.minute)
            .map((e) => (
              <li key={e.id}>
                <span className="control__event-minute">{e.minute}'</span>
                <EventIcon type={e.type} />
                <span className="control__event-text">
                  {playerName(e.playerId) ?? EVENT_LABEL[e.type]}
                  <small> · {e.side === "A" ? labelA : labelB}</small>
                </span>
                <button type="button" className="admin-btn admin-btn--icon" disabled={pending} onClick={() => void push(removeEvent(state, e.id))} aria-label={`Remove ${EVENT_LABEL[e.type].toLowerCase()} at ${e.minute} minutes`}>
                  ✕
                </button>
              </li>
            ))}
        </ul>
      )}

      {ended && winner !== "DRAW" && (
        <button type="button" className="admin-btn admin-btn--primary admin-btn--block" onClick={() => onComplete(winner, `${s.a}-${s.b}`)}>
          Complete match · {winner === "A" ? labelA : labelB} wins {s.a}-{s.b}
        </button>
      )}

      {ended && winner === "DRAW" && !penaltiesOnDraw && (
        <p className="control__context">Level at {s.a}-{s.b}. This competition has no shoot-out; record the outcome under End match early.</p>
      )}

      {ended && winner === "DRAW" && penaltiesOnDraw && (
        <div className="control__penalties">
          <p className="control__context">
            Level at {s.a}-{s.b}. Enter the penalty shootout result to decide the winner.
          </p>
          <div className="control__pair control__pair--inputs">
            <label className="admin-field">
              <span className="admin-field__label">{labelA}</span>
              <input className="admin-input" type="number" inputMode="numeric" min={0} value={penA} onChange={(e) => setPenA(e.target.value)} />
            </label>
            <label className="admin-field">
              <span className="admin-field__label">{labelB}</span>
              <input className="admin-input" type="number" inputMode="numeric" min={0} value={penB} onChange={(e) => setPenB(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--primary admin-btn--block"
            disabled={!penaltiesValid}
            onClick={() => onComplete(pa > pb ? "A" : "B", `${s.a}-${s.b} (penalties ${pa}-${pb})`, { a: pa, b: pb })}
          >
            Complete on penalties
          </button>
        </div>
      )}
    </div>
  );
}
