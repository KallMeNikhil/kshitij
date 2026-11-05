import { motion } from "framer-motion";
import { useResolvedSlot, type ResolvedSlot } from "../hooks/useEntity";
import { useMatchState } from "../hooks/useFirestoreData";
import { StatusBadge } from "./StatusBadge";
import { ScoreValue } from "./ScoreValue";
import { SportIcon } from "./kshitij/SportIcon";
import { getSportMeta } from "./kshitij/sportMeta";
import { compactScore } from "../lib/scoreSummary";
import { placeholderLabel } from "../lib/matchLabels";
import { resolveScoringModel } from "../../shared/scoring/registry";
import { formatDateTime, roundLabel as roundLabelFor } from "../lib/format";
import { springs } from "../motion/springs";
import type { CSSProperties } from "react";
import type { FixtureDoc, MatchStateDoc, SportDoc } from "../../shared/types";

export type MatchTileDensity = "default" | "compact" | "row" | "card" | "result";

interface Side {
  name: string;
  college?: string;
  placeholder: boolean;
  isBye: boolean;
  withdrawn: boolean;
}

function describeSide(
  resolved: ResolvedSlot | null,
  fixture: FixtureDoc,
  slotKey: "slotA" | "slotB",
  siblings: readonly FixtureDoc[] | null | undefined,
  terminal: boolean,
  tbd: boolean
): Side {
  const slot = fixture[slotKey];
  const college = resolved?.participant?.college ?? resolved?.team?.college;
  if (!resolved) {
    return { name: "…", placeholder: false, isBye: false, withdrawn: false };
  }
  if (resolved.kind === "BYE") return { name: "BYE", placeholder: false, isBye: true, withdrawn: false };
  if (resolved.kind === "FIXTURE_WINNER" || resolved.kind === "TBD") {
    return { name: tbd ? "TBD" : placeholderLabel(slot, siblings ?? null), placeholder: true, isBye: false, withdrawn: false };
  }
  return {
    name: resolved.label,
    college,
    placeholder: false,
    isBye: false,
    withdrawn: !terminal && !!resolved.withdrawn,
  };
}

export function MatchTile({
  fixture,
  onOpen,
  density = "default",
  showSport = false,
  sportName,
  competitionName,
  sport,
  totalRounds,
  siblings,
  matchState: providedState,
  showRound = true,
}: {
  fixture: FixtureDoc;
  onOpen: (id: string) => void;
  density?: MatchTileDensity;
  showSport?: boolean;
  sportName?: string;
  competitionName?: string;
  sport?: Pick<SportDoc, "matchConfiguration" | "slug"> | null;
  totalRounds?: number;
  siblings?: readonly FixtureDoc[] | null;
  matchState?: MatchStateDoc | null;
  showRound?: boolean;
}) {
  const a = useResolvedSlot(fixture.slotA);
  const b = useResolvedSlot(fixture.slotB);
  const isLive = fixture.status === "LIVE";
  const isCompleted = fixture.status === "COMPLETED";
  const needsState = isLive || isCompleted;
  const selfSubscribe = needsState && providedState === undefined;
  const ownState = useMatchState(selfSubscribe ? fixture.fixtureId : null);
  const matchState = providedState !== undefined ? providedState : ownState;
  const scoringModel = resolveScoringModel(fixture, sport);
  const matchConfiguration = fixture.matchConfigurationSnapshot ?? sport?.matchConfiguration ?? null;
  const score = needsState ? compactScore(scoringModel, matchState, isCompleted, matchConfiguration) : null;
  const terminal = isCompleted || fixture.status === "CANCELLED";

  const tbd = density === "result";
  const sideA = describeSide(a, fixture, "slotA", siblings, terminal, tbd);
  const sideB = describeSide(b, fixture, "slotB", siblings, terminal, tbd);
  const hasBye = sideA.isBye || sideB.isBye;

  let winnerSlot: "A" | "B" | null = matchState?.result?.winnerSlot ?? null;
  if (!winnerSlot && isCompleted && hasBye) winnerSlot = sideA.isBye ? "B" : "A";

  const isPostponed = fixture.status === "POSTPONED";
  const isCancelled = fixture.status === "CANCELLED";
  const slug = sport?.slug ?? fixture.sportId;
  const meta = getSportMeta(slug);
  const round = totalRounds ? roundLabelFor(fixture.round, totalRounds) : `Round ${fixture.round}`;
  const when = formatDateTime(fixture.scheduledDate, fixture.scheduledTime);
  const showScore = !!score && !hasBye;
  const style = { "--sport-accent": meta.accent, "--sport-accent-soft": meta.accentSoft } as CSSProperties;

  const classes = [
    "match-tile",
    `match-tile--${density}`,
    density === "result" && "match-tile--row",
    isLive && "is-live",
    isCompleted && "is-completed",
    (isPostponed || isCancelled) && "is-pending",
    isCancelled && "is-cancelled",
    hasBye && "is-bye",
  ]
    .filter(Boolean)
    .join(" ");

  const renderSide = (side: Side, key: "A" | "B", position: "a" | "b" = key === "A" ? "a" : "b") => {
    const state = winnerSlot ? (winnerSlot === key ? "is-winner" : "is-loser") : "";
    const value = showScore ? (key === "A" ? score!.a : score!.b) : null;
    return (
      <div className={`match-tile__side match-tile__side--${position} ${state} ${side.placeholder ? "is-placeholder" : ""} ${side.isBye ? "is-bye-side" : ""}`}>
        <span className="match-tile__who">
          <span className="match-tile__name">{side.name}</span>
          {side.college && density === "default" && (
            <span className="match-tile__college">{side.college}</span>
          )}
          {side.withdrawn && <span className="match-tile__withdrawn">Withdrawn</span>}
        </span>
        {value !== null && (
          <span className="match-tile__score">
            <ScoreValue value={value} />
          </span>
        )}
      </div>
    );
  };

  const separator = density === "row" || density === "result" ? <span className="match-tile__vs" aria-hidden="true">{showScore ? "–" : "vs"}</span> : null;

  const summaryText = isCompleted && matchState?.result?.summary && !showScore && !hasBye ? matchState.result.summary : null;

  if (hasBye) {
    const other = sideA.isBye ? sideB : sideA;
    return (
      <motion.button
        type="button"
        className="match-tile match-tile--bye"
        style={style}
        onClick={() => onOpen(fixture.fixtureId)}
        transition={springs.settle}
        aria-label={`${other.name}, bye, ${round}`}
      >
        <span className="match-tile__bye-name">{other.name}</span>
        <span className="match-tile__bye-dot" aria-hidden="true">·</span>
        <span className="match-tile__bye-tag">BYE</span>
      </motion.button>
    );
  }

  const swap = density === "result" && winnerSlot === "B";
  const first = swap ? ([sideB, "B"] as const) : ([sideA, "A"] as const);
  const second = swap ? ([sideA, "A"] as const) : ([sideB, "B"] as const);
  const roundText = density === "result" ? round : [competitionName, round].filter(Boolean).join(" · ");
  const showBadge = density !== "result";
  const showSub = !!score?.sub || !!summaryText;

  return (
    <motion.button
      type="button"
      className={classes}
      style={style}
      onClick={() => onOpen(fixture.fixtureId)}
      whileTap={{ scale: 0.985 }}
      transition={springs.settle}
      aria-label={`${sideA.name} versus ${sideB.name}, ${round}, ${fixture.status.toLowerCase()}`}
    >
      <div className="match-tile__meta">
        {showSport && (
          <span className="match-tile__sport">
            <SportIcon slug={slug} size={13} />
            <span className="match-tile__sport-name">{sportName ?? fixture.sportId}</span>
          </span>
        )}
        {showRound && <span className="match-tile__round">{roundText}</span>}
        {showBadge && <StatusBadge status={fixture.status} className="match-tile__status" />}
      </div>

      <div className="match-tile__matchup">
        {density === "result" ? renderSide(first[0], first[1], "a") : renderSide(sideA, "A")}
        {separator}
        {density === "result" ? renderSide(second[0], second[1], "b") : renderSide(sideB, "B")}
      </div>

      {showSub && <div className="match-tile__sub">{score?.sub ?? summaryText}</div>}

      {density === "result" && (
        <svg className="match-tile__tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}

      {density !== "result" && !isLive && !isCancelled && (!needsState || (isCompleted && density !== "compact")) && (when || fixture.venue) && (
        <div className="match-tile__schedule">
          {isPostponed && when && <span>Originally {when}</span>}
          {isPostponed && !when && <span>New date to be announced</span>}
          {!isPostponed && when && <span>{when}</span>}
          {fixture.venue && <span>{fixture.venue}</span>}
        </div>
      )}
      {isCancelled && (
        <div className="match-tile__schedule">
          <span>Match cancelled</span>
          {fixture.statusReason && <span>{fixture.statusReason}</span>}
        </div>
      )}
      {isPostponed && (
        <div className="match-tile__schedule">
          <span>{fixture.resumeStatus === "LIVE" ? "Play suspended" : "Rescheduling pending"}</span>
          {fixture.statusReason && <span>{fixture.statusReason}</span>}
        </div>
      )}
    </motion.button>
  );
}
