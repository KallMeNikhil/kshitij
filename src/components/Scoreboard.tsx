import type { MatchStateDoc } from "../../shared/types";
import { setsSummary, type SetsPointsState } from "../../shared/scoring/sets-points";
import type { CricketInningsState } from "../../shared/scoring/cricket-innings";
import { target, runsRequired, ballsRemaining } from "../../shared/scoring/cricket-innings";
import type { FootballState } from "../../shared/scoring/football-events";
import { score as footballScore, cardsFor } from "../../shared/scoring/football-events";
import type { BasketballState } from "../../shared/scoring/basketball-points";
import type { TennisState } from "../../shared/scoring/tennis-sets-games";
import { boardsWon, type ResultOnlyState } from "../../shared/scoring/result-only";
import { tennisSummary } from "../../shared/scoring/tennis-sets-games";
import { CardIcon, GoalIcon } from "./admin/scoring/EventIcons";
import { ScoreValue } from "./ScoreValue";
import { basketballConfigFrom } from "../../shared/scoring/fromMatchConfiguration";
import { periodName, periodScores } from "../../shared/scoring/basketball-points";
import type { MatchConfiguration } from "../../shared/matchConfig";

const EVENT_NAME = { GOAL: "Goal", PENALTY_GOAL: "Penalty goal", OWN_GOAL: "Own goal", YELLOW_CARD: "Yellow card", RED_CARD: "Red card" } as const;

export function SetsPointsScoreboard({ state, labelA, labelB }: { state: SetsPointsState; labelA: string; labelB: string }) {
  const current = state.sets[state.currentSet];
  return (
    <div className="scoreboard scoreboard--sets">
      <div className="scoreboard__current">
        <span>{labelA}</span>
        <span className="scoreboard__big">
          <ScoreValue value={current.a} /> – <ScoreValue value={current.b} />
        </span>
        <span>{labelB}</span>
      </div>
      <p className="scoreboard__period">Set {state.currentSet + 1}</p>
      {setsSummary(state) && <div className="scoreboard__sets-history">Completed sets: {setsSummary(state)}</div>}
    </div>
  );
}

export function CricketScoreboard({ state, labelA, labelB }: { state: CricketInningsState; labelA: string; labelB: string }) {
  const t = target(state);
  const req = runsRequired(state);
  const battingFirstLabel = state.battingFirst === "A" ? labelA : labelB;
  const chasingLabel = state.battingFirst === "A" ? labelB : labelA;
  return (
    <div className="scoreboard scoreboard--cricket">
      <div className="scoreboard__innings">
        <span>{battingFirstLabel}</span>
        <span className="scoreboard__big">
          {state.innings1.runs}/{state.innings1.wickets}
        </span>
        <span className="scoreboard__overs">{state.innings1.oversCompleted}.{state.innings1.ballsInOver} ov</span>
      </div>
      <div className="scoreboard__innings">
        <span>{chasingLabel}</span>
        <span className="scoreboard__big">
          {state.innings2.runs}/{state.innings2.wickets}
        </span>
        <span className="scoreboard__overs">{state.innings2.oversCompleted}.{state.innings2.ballsInOver} ov</span>
      </div>
      {t !== null && (
        <div className="scoreboard__chase">
          Target {t} · Need {req} off {ballsRemaining(state)} balls
        </div>
      )}
    </div>
  );
}

export function FootballScoreboard({ state, labelA, labelB, penalties: storedPenalties }: { state: FootballState; labelA: string; labelB: string; penalties?: { a: number; b: number } }) {
  const s = footballScore(state);
  const penalties = state.penalties ?? storedPenalties;
  const cardsA = cardsFor(state, "A");
  const cardsB = cardsFor(state, "B");
  return (
    <div className="scoreboard scoreboard--football">
      <div className="scoreboard__current">
        <span>{labelA}</span>
        <span className="scoreboard__big">
          <ScoreValue value={s.a} /> – <ScoreValue value={s.b} />
        </span>
        <span>{labelB}</span>
      </div>
      {penalties && (
        <p className="scoreboard__period">
          Penalties {penalties.a} – {penalties.b}
        </p>
      )}
      {state.events.length > 0 && (
        <ul className="scoreboard__events" aria-label="Match events">
          {state.events
            .slice()
            .sort((x, y) => x.minute - y.minute)
            .map((e) => (
              <li key={e.id} className="scoreboard__event">
                <span className="scoreboard__event-minute">{e.minute}'</span>
                {e.type === "GOAL" || e.type === "PENALTY_GOAL" || e.type === "OWN_GOAL" ? <GoalIcon size={16} /> : <CardIcon tone={e.type === "YELLOW_CARD" ? "yellow" : "red"} size={16} />}
                <span>
                  {EVENT_NAME[e.type]} · {e.side === "A" ? labelA : labelB}
                </span>
              </li>
            ))}
        </ul>
      )}
      {(cardsA.yellow.length + cardsA.red.length > 0 || cardsB.yellow.length + cardsB.red.length > 0) && (
        <div className="scoreboard__cards">
          {cardsA.yellow.length + cardsA.red.length > 0 && (
            <span>
              {labelA}: {cardsA.yellow.length} yellow, {cardsA.red.length} red
            </span>
          )}
          {cardsB.yellow.length + cardsB.red.length > 0 && (
            <span>
              {labelB}: {cardsB.yellow.length} yellow, {cardsB.red.length} red
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function BasketballScoreboard({
  state,
  labelA,
  labelB,
  matchConfiguration,
}: {
  state: BasketballState;
  labelA: string;
  labelB: string;
  matchConfiguration?: MatchConfiguration | null;
}) {
  const config = basketballConfigFrom(matchConfiguration);
  const breakdown = periodScores(state);
  return (
    <div className="scoreboard scoreboard--basketball">
      <div className="scoreboard__current">
        <span>{labelA}</span>
        <span className="scoreboard__big">
          <ScoreValue value={state.scoreA} /> – <ScoreValue value={state.scoreB} />
        </span>
        <span>{labelB}</span>
      </div>
      <div className="scoreboard__period">{periodName(state.period, config)}</div>
      {breakdown.length > 0 && (
        <ul className="scoreboard__events" aria-label="Completed periods">
          {breakdown.map((p) => (
            <li key={p.period} className="scoreboard__event">
              <span className="scoreboard__event-minute">{periodName(p.period, config).replace("Quarter ", "Q").replace("Half ", "H").replace("Period ", "P")}</span>
              <span>
                {p.a} – {p.b}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TennisScoreboard({ state, labelA, labelB }: { state: TennisState; labelA: string; labelB: string }) {
  const current = state.sets[state.sets.length - 1];
  return (
    <div className="scoreboard scoreboard--tennis">
      <div className="scoreboard__current">
        <span>{labelA}</span>
        <span className="scoreboard__big">
          <ScoreValue value={current.gamesA} /> – <ScoreValue value={current.gamesB} />
        </span>
        <span>{labelB}</span>
      </div>
      <p className="scoreboard__points">
        {state.tiebreak
          ? `${state.tiebreak.super ? "Match tie-break" : "Tie-break"} ${state.tiebreak.a} – ${state.tiebreak.b}`
          : `Current game ${state.currentGame.pointsA} – ${state.currentGame.pointsB}`}
      </p>
      {state.sets.some((x) => x.completed) && <div className="scoreboard__sets-history">Completed sets: {tennisSummary(state)}</div>}
    </div>
  );
}

export function ResultOnlyScoreboard({
  state,
  winnerSlot,
  labelA,
  labelB,
}: {
  state: ResultOnlyState;
  winnerSlot?: "A" | "B" | null;
  labelA: string;
  labelB: string;
}) {
  const winner = winnerSlot ?? (state.outcome === "A" || state.outcome === "B" ? state.outcome : state.tieBreakWinner ?? null);
  const boards = state.boards ?? [];
  const won = boardsWon(state);
  return (
    <div className="scoreboard scoreboard--result-only">
      {boards.length > 0 && (
        <div className="scoreboard__current">
          <span>{labelA}</span>
          <span className="scoreboard__big">
            <ScoreValue value={won.a} /> – <ScoreValue value={won.b} />
          </span>
          <span>{labelB}</span>
        </div>
      )}
      {boards.length > 0 && <div className="scoreboard__sets-history">Boards: {boards.map((x) => `${x.a}-${x.b}`).join(", ")}</div>}
      {winner ? (
        <span className="scoreboard__big">{winner === "A" ? labelA : labelB} wins</span>
      ) : state.outcome === "DRAW" ? (
        <span className="scoreboard__pending">Drawn, tie-break to follow</span>
      ) : (
        <span className="scoreboard__pending">{boards.length > 0 ? "In progress" : "Result pending"}</span>
      )}
      {state.outcome === "DRAW" && state.tieBreakWinner && <p className="scoreboard__period">Drawn, decided on tie-break</p>}
      {state.method && <p className="scoreboard__period">{state.method}</p>}
    </div>
  );
}

export function Scoreboard({
  scoringModel,
  matchState,
  labelA,
  labelB,
  matchConfiguration,
}: {
  scoringModel: string;
  matchState: MatchStateDoc | null;
  labelA: string;
  labelB: string;
  matchConfiguration?: MatchConfiguration | null;
}) {
  if (!matchState) return <div className="scoreboard scoreboard--empty">Match not yet started</div>;
  if (!matchState.data) return null;
  const data = matchState.data as Record<string, unknown>;
  switch (scoringModel) {
    case "SETS_POINTS":
      return <SetsPointsScoreboard state={data as unknown as SetsPointsState} labelA={labelA} labelB={labelB} />;
    case "CRICKET_INNINGS":
      return <CricketScoreboard state={data as unknown as CricketInningsState} labelA={labelA} labelB={labelB} />;
    case "FOOTBALL_EVENTS":
      return <FootballScoreboard state={data as unknown as FootballState} labelA={labelA} labelB={labelB} penalties={matchState.penalties} />;
    case "BASKETBALL_POINTS":
      return <BasketballScoreboard state={data as unknown as BasketballState} labelA={labelA} labelB={labelB} matchConfiguration={matchConfiguration} />;
    case "TENNIS_SETS_GAMES":
      return <TennisScoreboard state={data as unknown as TennisState} labelA={labelA} labelB={labelB} />;
    case "RESULT_ONLY":
      return <ResultOnlyScoreboard state={data as unknown as ResultOnlyState} winnerSlot={matchState.result?.winnerSlot ?? null} labelA={labelA} labelB={labelB} />;
    default:
      return null;
  }
}
