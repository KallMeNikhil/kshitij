import { useId, useMemo, useRef } from "react";
import { motion, useDragControls, type PanInfo } from "framer-motion";
import { useCompetition, useFixtures, useFixtureState, useMatchStateState } from "../hooks/useFirestoreData";
import { usePublicSports } from "../lib/PublicDataContext";
import { useResolvedSlot, type ResolvedSlot } from "../hooks/useEntity";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { minWidth } from "../lib/breakpoints";
import { useDialogBehavior } from "../hooks/useDialogBehavior";
import { TeamRoster } from "./TeamRoster";
import { ContactActions } from "./ContactActions";
import { Scoreboard } from "./Scoreboard";
import { StatusBadge } from "./StatusBadge";
import { SportIcon } from "./kshitij/SportIcon";
import { EmptyState, ErrorState, LoadingState } from "./states/StateViews";
import { compactScore } from "../lib/scoreSummary";
import { springs } from "../motion/springs";
import { durations } from "../motion/durations";
import { resolveScoringModel } from "../../shared/scoring/registry";
import { formatDateTime, roundLabel } from "../lib/format";

function Entrant({
  slot,
  side,
  winnerSlot,
  score,
}: {
  slot: ResolvedSlot | null;
  side: "A" | "B";
  winnerSlot: "A" | "B" | null | undefined;
  score?: string;
}) {
  const isWinner = winnerSlot === side;
  const isLoser = winnerSlot === (side === "A" ? "B" : "A");
  const college = slot?.participant?.college ?? slot?.team?.college;
  const name = slot?.label ?? "TBD";
  return (
    <div className={`match-sheet__entrant ${isWinner ? "is-winner" : ""} ${isLoser ? "is-loser" : ""}`}>
      <div className="match-sheet__entrant-head">
        <span className="match-sheet__entrant-name">{name}</span>
        {score !== undefined && <span className="match-sheet__entrant-score">{score}</span>}
      </div>
      {college && <span className="match-sheet__entrant-college">{college}</span>}
      {slot?.kind === "BYE" && <span className="match-sheet__entrant-college">Advances automatically</span>}
      {isWinner && <span className="match-sheet__winner-tag">Winner</span>}
    </div>
  );
}

export interface MatchModalContext {
  competitionId: string;
  competitionName: string;
  totalRounds: number;
}

export function MatchModal({ fixtureId, onClose, context }: { fixtureId: string; onClose: () => void; context?: MatchModalContext }) {
  const fixtureState = useFixtureState(fixtureId);
  const fixture = fixtureState.data && fixtureState.data !== "MISSING" ? fixtureState.data : null;
  const missing = fixtureState.data === "MISSING";
  const matchStateState = useMatchStateState(fixtureId);
  const matchState = matchStateState.data && matchStateState.data !== "MISSING" ? matchStateState.data : null;
  const sports = usePublicSports();
  const hinted = !!fixture && !!context && fixture.competitionId === context.competitionId;
  const competitionDoc = useCompetition(!hinted && fixture ? fixture.competitionId : null);
  const competitionName = hinted ? context!.competitionName : competitionDoc?.name;
  const a = useResolvedSlot(fixture?.slotA);
  const b = useResolvedSlot(fixture?.slotB);
  const siblingFixtures = useFixtures(!hinted && fixture ? fixture.competitionId : null);
  const totalRounds = useMemo(
    () => (hinted ? context!.totalRounds : siblingFixtures ? new Set(siblingFixtures.map((f) => f.round)).size : 0),
    [hinted, context, siblingFixtures]
  );
  const isDesktop = useMediaQuery(minWidth("desktop"));
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const titleId = useId();
  useDialogBehavior(sheetRef, onClose);

  const sport = fixture ? sports?.find((s) => s.sportId === fixture.sportId) ?? null : null;
  const sportName = sport?.name ?? fixture?.sportId ?? null;
  const when = fixture ? formatDateTime(fixture.scheduledDate, fixture.scheduledTime) : null;
  const title = fixture ? `${a?.label ?? "TBD"} vs ${b?.label ?? "TBD"}` : "Match details";
  const result = matchState?.result;
  const scoringModel = fixture ? resolveScoringModel(fixture, sport) : null;
  const matchConfiguration = fixture ? fixture.matchConfigurationSnapshot ?? sport?.matchConfiguration ?? null : null;
  const hasBye = a?.kind === "BYE" || b?.kind === "BYE";
  const scores =
    fixture && scoringModel && !hasBye && (fixture.status === "LIVE" || fixture.status === "COMPLETED")
      ? compactScore(scoringModel, matchState, fixture.status === "COMPLETED", matchConfiguration)
      : null;
  const liveUnavailable = !!fixture && fixture.status === "LIVE" && !matchState;
  const showRoster = a?.kind === "TEAM" || b?.kind === "TEAM";
  const participantContacts = [a, b].filter((s): s is ResolvedSlot => s?.kind === "PARTICIPANT" && !!s.participant);

  const onDragEnd = (_: PointerEvent, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  return (
    <motion.div
      className="match-modal__overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: durations.microInteraction }}
    >
      <motion.div
        ref={sheetRef}
        className="match-modal__sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={isDesktop ? { x: "100%" } : { y: "100%" }}
        animate={isDesktop ? { x: 0 } : { y: 0 }}
        exit={isDesktop ? { x: "100%" } : { y: "100%" }}
        transition={springs.sheet}
        drag={isDesktop ? false : "y"}
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={onDragEnd}
      >
        {!isDesktop && (
          <div className="match-modal__handle" aria-hidden="true" onPointerDown={(e) => dragControls.start(e)} />
        )}

        <header className="match-modal__header" onPointerDown={(e) => !isDesktop && dragControls.start(e)}>
          <button type="button" className="match-modal__close" onClick={onClose} aria-label="Close match details">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          {fixture ? (
            <>
              <div className="match-modal__header-row">
                <span className="match-modal__sport">
                  <SportIcon slug={fixture.sportId} size={14} />
                  {sportName}
                </span>
                <StatusBadge status={fixture.status} />
              </div>
              <h2 id={titleId} className="match-modal__title">
                {title}
              </h2>
              <span className="match-modal__round">
                {[
                  competitionName,
                  totalRounds > 0 ? roundLabel(fixture.round, totalRounds) : `Round ${fixture.round}`,
                  `Match ${fixture.matchNumber}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </>
          ) : (
            <h2 id={titleId} className="match-modal__title">
              {title}
            </h2>
          )}
        </header>

        {fixtureState.error ? (
          <div className="match-modal__body">
            <ErrorState title="This match couldn't be loaded" hint="Check your connection and try again." onRetry={fixtureState.retry} />
          </div>
        ) : missing ? (
          <div className="match-modal__body">
            <EmptyState title="Match not found" hint="It may have been removed or isn't published yet." />
          </div>
        ) : !fixture ? (
          <div className="match-modal__body">
            <LoadingState label="Loading match" rows={3} />
          </div>
        ) : (
          <div className="match-modal__body">
            <section className="match-sheet__entrants" aria-label="Entrants">
              <Entrant slot={a} side="A" winnerSlot={result?.winnerSlot} score={scores?.a} />
              <Entrant slot={b} side="B" winnerSlot={result?.winnerSlot} score={scores?.b} />
            </section>

            {liveUnavailable ? (
              <section className="match-sheet__result" aria-label="Score">
                <EmptyState
                  title="Live details not available yet"
                  hint={matchStateState.error ? "The score couldn't be loaded. It will appear here once it's available." : "The score will appear here as soon as scoring starts."}
                />
              </section>
            ) : fixture.status !== "SCHEDULED" || matchState ? (
              <Scoreboard
                scoringModel={scoringModel!}
                matchState={matchState}
                labelA={a?.label ?? "TBD"}
                labelB={b?.label ?? "TBD"}
                matchConfiguration={matchConfiguration}
              />
            ) : null}

            {(fixture.status === "POSTPONED" || fixture.status === "CANCELLED") && (
              <section className="match-sheet__result" aria-label="Status">
                <h3 className="match-sheet__heading">{fixture.status === "POSTPONED" ? "Postponed" : "Cancelled"}</h3>
                <p className="match-sheet__result-summary">
                  {fixture.status === "POSTPONED"
                    ? fixture.resumeStatus === "LIVE"
                      ? "Play is suspended and will resume."
                      : "This match has been postponed. A new time will be announced."
                    : "This match will not be played."}
                </p>
                {fixture.statusReason && <p className="match-sheet__result-meta">{fixture.statusReason}</p>}
              </section>
            )}

            {result && (
              <section className="match-sheet__result" aria-label="Result">
                <h3 className="match-sheet__heading">Result</h3>
                <p className="match-sheet__result-summary">{result.summary}</p>
                {result.decidedBy && <p className="match-sheet__result-meta">Decided by {result.decidedBy.toLowerCase().replace(/_/g, " ")}</p>}
              </section>
            )}

            {(when || fixture.venue) && (
              <section className="match-sheet__schedule" aria-label="Schedule">
                <h3 className="match-sheet__heading">Schedule</h3>
                <dl>
                  {when && (
                    <div>
                      <dt>When</dt>
                      <dd>{when}</dd>
                    </div>
                  )}
                  {fixture.venue && (
                    <div>
                      <dt>Venue</dt>
                      <dd>{fixture.venue}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}

            {participantContacts.length > 0 && (
              <section className="match-sheet__contacts" aria-label="Contact">
                <h3 className="match-sheet__heading">Contact</h3>
                {participantContacts.map((s) => (
                  <div key={s.participant!.participantId} className="match-modal__contact">
                    <span>
                      {s.participant!.name} · {s.participant!.college}
                    </span>
                    <ContactActions phone={s.participant!.phone} name={s.participant!.name} />
                  </div>
                ))}
              </section>
            )}

            {showRoster && (
              <section className="match-modal__rosters" aria-label="Rosters">
                <h3 className="match-sheet__heading">Rosters</h3>
                {a?.kind === "TEAM" && a.team && <TeamRoster team={a.team} />}
                {b?.kind === "TEAM" && b.team && <TeamRoster team={b.team} />}
              </section>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
