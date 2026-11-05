import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { useFixtures, useFixtureState, useMatchStateState } from "../../hooks/useFirestoreData";
import { useResolvedSlot } from "../../hooks/useEntity";
import { useAdminScope } from "../../lib/useAdminScope";
import { resolveScoringModel } from "../../../shared/scoring/registry";
import { startMatch, completeMatch, correctResult, postponeFixture, resumeFixture, cancelFixture } from "../../lib/callables";
import { availableLifecycleActions, LIFECYCLE_COPY, REASON_MAX_LENGTH, type LifecycleAction } from "../../../shared/fixtureLifecycle";
import { checkScheduleDraft } from "../../../shared/schedule";
import { StatusBadge } from "../../components/StatusBadge";
import { SportIcon } from "../../components/kshitij/SportIcon";
import { ConfirmSheet } from "../../components/admin/ConfirmSheet";
import { ActionStatus, type ActionMessage } from "../../components/admin/ActionStatus";
import { ErrorState, LoadingState, NotFoundState } from "../../components/states/StateViews";
import { SetsPointsControl } from "../../components/admin/scoring/SetsPointsControl";
import { CricketControl } from "../../components/admin/scoring/CricketControl";
import { FootballControl } from "../../components/admin/scoring/FootballControl";
import { BasketballControl } from "../../components/admin/scoring/BasketballControl";
import { TennisControl } from "../../components/admin/scoring/TennisControl";
import { ResultOnlyControl } from "../../components/admin/scoring/ResultOnlyControl";
import { compactScore } from "../../lib/scoreSummary";
import { ScoreValue } from "../../components/ScoreValue";
import { downstreamStarted } from "../../lib/needsAction";
import { formatDateTime, roundLabel } from "../../lib/format";
import type { CompleteHandler } from "../../components/admin/scoring/types";

type Sheet =
  | { kind: "start" }
  | { kind: "complete"; winnerSlot: "A" | "B"; summary: string; penalties?: { a: number; b: number } }
  | { kind: "walkover"; winnerSlot: "A" | "B" }
  | { kind: "correct" }
  | { kind: "lifecycle"; action: LifecycleAction }
  | null;

export function LiveScoringPage() {
  const { fixtureId } = useParams();
  const fixtureState = useFixtureState(fixtureId ?? null);
  const fixture = fixtureState.data && fixtureState.data !== "MISSING" ? fixtureState.data : null;
  const matchStateState = useMatchStateState(fixtureId ?? null);
  const matchState = matchStateState.data && matchStateState.data !== "MISSING" ? matchStateState.data : null;
  const { isSuper, sports, canAccessSport } = useAdminScope();
  const a = useResolvedSlot(fixture?.slotA);
  const b = useResolvedSlot(fixture?.slotB);
  const siblings = useFixtures(fixture?.competitionId ?? null, true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [walkoverReason, setWalkoverReason] = useState("");
  const [correctionWinner, setCorrectionWinner] = useState<"A" | "B" | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [resumeDate, setResumeDate] = useState("");
  const [resumeTime, setResumeTime] = useState("");
  const [resumeVenue, setResumeVenue] = useState("");

  const sport = sports?.find((s) => s.sportId === fixture?.sportId);
  const scoringModel = fixture ? resolveScoringModel(fixture, sport) : null;
  const matchConfiguration = fixture?.matchConfigurationSnapshot ?? sport?.matchConfiguration ?? null;
  const totalRounds = siblings ? new Set(siblings.map((f) => f.round)).size : 0;
  const labelA = a?.label ?? "Side A";
  const labelB = b?.label ?? "Side B";
  const score = useMemo(
    () => (scoringModel ? compactScore(scoringModel, matchState, fixture?.status === "COMPLETED", fixture?.matchConfigurationSnapshot ?? sport?.matchConfiguration ?? null) : null),
    [scoringModel, matchState, fixture?.status]
  );

  if (!fixtureId) return <NotFoundState title="Fixture not found" />;
  if (fixtureState.error) return <ErrorState title="This match couldn't be loaded" hint="Check your connection and try again." onRetry={fixtureState.retry} />;
  if (fixtureState.data === "MISSING") return <NotFoundState title="Match not found" hint="It may have been removed." />;
  if (!fixture || !scoringModel) return <LoadingState label="Loading match" rows={3} />;
  if (!canAccessSport(fixture.sportId)) {
    return (
      <div className="admin-page">
        <p className="admin-empty">This match belongs to a sport that isn't assigned to your account.</p>
        <Link className="admin-btn" to="/admin/fixtures">
          Back to fixtures
        </Link>
      </div>
    );
  }

  if (fixture.status === "LIVE" || fixture.status === "COMPLETED") {
    if (matchStateState.error) {
      return <ErrorState title="The score couldn't be loaded" hint="Scoring is paused until the saved score is available. Check your connection and try again." onRetry={matchStateState.retry} />;
    }
    if (matchStateState.loading) return <LoadingState label="Loading score" rows={3} />;
  }

  const nextFixture = fixture.nextFixtureId ? siblings?.find((f) => f.fixtureId === fixture.nextFixtureId) : undefined;
  const roundName = totalRounds > 0 ? roundLabel(fixture.round, totalRounds) : `Round ${fixture.round}`;
  const when = formatDateTime(fixture.scheduledDate, fixture.scheduledTime);
  const isBye = fixture.slotA.kind === "BYE" || fixture.slotB.kind === "BYE";
  const winnerLabel = (slot: "A" | "B") => (slot === "A" ? labelA : labelB);
  const recordedWinner = matchState?.result?.winnerSlot ?? null;
  const lifecycleActions = availableLifecycleActions(fixture).filter((action) => isSuper || action !== "cancel");
  const resumesToLive = fixture.resumeStatus === "LIVE";
  const resumeScheduleTouched = Boolean(resumeDate || resumeTime || resumeVenue.trim());
  const resumeCheck = resumeScheduleTouched ? checkScheduleDraft({ date: resumeDate, time: resumeTime, venue: resumeVenue }) : null;
  const blockedByDownstream = siblings ? downstreamStarted(siblings, fixture.fixtureId) : false;
  const progression = nextFixture ? `Winner advances to ${roundLabel(nextFixture.round, totalRounds)}, Match ${nextFixture.matchNumber}.` : "This is the last match in the bracket.";

  const succeed = (text: string) => {
    setSheet(null);
    setMessage({ kind: "success", text });
  };

  const runStart = async () => {
    await startMatch({ fixtureId });
    succeed("Match is live.");
  };

  const runComplete = async () => {
    if (sheet?.kind !== "complete") return;
    await completeMatch({
      fixtureId,
      winnerSlot: sheet.winnerSlot,
      decidedBy: scoringModel,
      resultSummary: sheet.summary,
      ...(sheet.penalties ? { penalties: sheet.penalties } : {}),
    });
    succeed(`Match completed. ${winnerLabel(sheet.winnerSlot)} advances.`);
  };

  const runWalkover = async () => {
    if (sheet?.kind !== "walkover") return;
    await completeMatch({ fixtureId, winnerSlot: sheet.winnerSlot, decidedBy: "WALKOVER", resultSummary: walkoverReason.trim() });
    setWalkoverReason("");
    succeed(`Walkover recorded. ${winnerLabel(sheet.winnerSlot)} advances.`);
  };

  const runCorrection = async () => {
    if (!correctionWinner) return;
    await correctResult({ fixtureId, winnerSlot: correctionWinner, reason: correctionReason.trim() });
    setCorrectionReason("");
    setCorrectionWinner(null);
    succeed(`Result corrected. ${winnerLabel(correctionWinner)} is now the winner.`);
  };

  const openLifecycle = (action: LifecycleAction) => {
    setLifecycleReason("");
    setResumeDate("");
    setResumeTime("");
    setResumeVenue("");
    setSheet({ kind: "lifecycle", action });
  };

  const runLifecycle = async () => {
    if (sheet?.kind !== "lifecycle") return;
    const reason = lifecycleReason.trim();
    if (sheet.action === "postpone") await postponeFixture({ fixtureId, reason });
    else if (sheet.action === "cancel") await cancelFixture({ fixtureId, reason });
    else {
      await resumeFixture({
        fixtureId,
        ...(resumeCheck?.ok ? { scheduledDate: resumeCheck.value.scheduledDate, scheduledTime: resumeCheck.value.scheduledTime } : {}),
        ...(resumeCheck?.ok && resumeCheck.value.venue ? { venue: resumeCheck.value.venue } : {}),
      });
    }
    succeed(`Match ${LIFECYCLE_COPY[sheet.action].past}.`);
  };

  const onComplete: CompleteHandler = (winnerSlot, summary, penalties) => setSheet({ kind: "complete", winnerSlot, summary, penalties });

  const controlProps = {
    fixtureId,
    labelA,
    labelB,
    matchState,
    onComplete,
    teamA: a?.team,
    teamB: b?.team,
  };

  return (
    <div className="admin-page live-scoring">
      <div className="live-scoring__layout">
        <div className="live-scoring__side">
          <div className="live-scoring__topbar">
            <Link to="/admin/fixtures" className="live-scoring__back" aria-label="Back to fixtures">
              ←
            </Link>
            <span className="live-scoring__sport">
              <SportIcon slug={sport?.slug ?? fixture.sportId} size={14} />
              {sport?.name ?? fixture.sportId}
            </span>
            <StatusBadge status={fixture.status} />
          </div>

          <h1 className="live-scoring__matchup">
            <span>
              {labelA}
              {a?.withdrawn && <small> (withdrawn)</small>}
            </span>
            <em>vs</em>
            <span>
              {labelB}
              {b?.withdrawn && <small> (withdrawn)</small>}
            </span>
          </h1>
          <p className="live-scoring__meta">
            {[roundName, `Match ${fixture.matchNumber}`, when, fixture.venue].filter(Boolean).join(" · ")}
          </p>

          {(fixture.status === "LIVE" || fixture.status === "COMPLETED") && score && !isBye && (
            <div className="live-scoring__summary" aria-live="polite">
              <span className="live-scoring__summary-side">{labelA}</span>
              <span className="live-scoring__summary-score">
                <ScoreValue value={score.a} /> – <ScoreValue value={score.b} />
              </span>
              <span className="live-scoring__summary-side live-scoring__summary-side--b">{labelB}</span>
              {score.sub && <span className="live-scoring__summary-sub">{score.sub}</span>}
            </div>
          )}

          {matchConfiguration && matchConfiguration.pending.length > 0 && (
            <div className="admin-alert admin-alert--warning" role="note">
              <strong>Rules not fully finalized for this match</strong>
              {matchConfiguration.pending.map((note, i) => (
                <span key={i}>{note}</span>
              ))}
            </div>
          )}

          <ActionStatus message={message} />
        </div>

        <div className="live-scoring__main">
          {fixture.status === "SCHEDULED" && (
            <div className="admin-card">
              <button type="button" className="admin-btn admin-btn--primary admin-btn--block admin-btn--large" onClick={() => setSheet({ kind: "start" })}>
                Start match
              </button>
              <p className="admin-hint">Starting puts this match live on the public site.</p>

              {isSuper && (
                <div className="live-scoring__walkover" role="group" aria-label="Record a walkover">
                  <h2 className="admin-card__title">Record a walkover</h2>
                  <p className="admin-hint">For a match that can't be played, for example an entrant withdrew or didn't show. Choose who advances and say why.</p>
                  <label className="admin-field">
                    <span className="admin-field__label">Reason (required)</span>
                    <input className="admin-input" value={walkoverReason} maxLength={300} onChange={(e) => setWalkoverReason(e.target.value)} placeholder="e.g. opponent withdrew" />
                  </label>
                  <div className="control__row">
                    {(["A", "B"] as const).map((side) => (
                      <button key={side} type="button" className="admin-btn" disabled={!walkoverReason.trim()} onClick={() => setSheet({ kind: "walkover", winnerSlot: side })}>
                        {winnerLabel(side)} advances
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {fixture.status === "LIVE" && (
            <div className="admin-card">
              {scoringModel === "SETS_POINTS" && <SetsPointsControl {...controlProps} sportId={fixture.sportId} matchConfiguration={matchConfiguration} />}
              {scoringModel === "CRICKET_INNINGS" && <CricketControl {...controlProps} matchConfiguration={matchConfiguration} />}
              {scoringModel === "FOOTBALL_EVENTS" && <FootballControl {...controlProps} />}
              {scoringModel === "BASKETBALL_POINTS" && <BasketballControl {...controlProps} matchConfiguration={matchConfiguration} />}
              {scoringModel === "TENNIS_SETS_GAMES" && <TennisControl {...controlProps} matchConfiguration={matchConfiguration} />}
              {scoringModel === "RESULT_ONLY" && <ResultOnlyControl {...controlProps} />}
            </div>
          )}

          {fixture.status === "COMPLETED" && (
            <div className="admin-card">
              <h2 className="admin-card__title">Result</h2>
              {isBye ? (
                <p className="admin-hint">Bye. The opponent advanced automatically.</p>
              ) : (
                <>
                  <p className="live-scoring__result">
                    {recordedWinner ? `${winnerLabel(recordedWinner)} won` : "Completed"}
                    {matchState?.result?.summary && <small> · {matchState.result.summary}</small>}
                  </p>
                  {matchState?.result?.decidedBy && <p className="admin-hint">Decided by {matchState.result.decidedBy.toLowerCase().replace(/_/g, " ")}.</p>}
                  {!isSuper ? (
                    <p className="admin-alert admin-alert--info" role="note">
                      A recorded result can only be changed by the Super Admin. Ask them if this one needs correcting.
                    </p>
                  ) : blockedByDownstream ? (
                    <p className="admin-alert admin-alert--warning" role="note">
                      A later match built on this result has already started or finished, so the result can no longer be corrected.
                    </p>
                  ) : (
                    <button type="button" className="admin-btn" onClick={() => { setCorrectionWinner(null); setCorrectionReason(""); setSheet({ kind: "correct" }); }}>
                      Correct result
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {fixture.status === "DRAFT" && (
            <p className="admin-alert admin-alert--info" role="note">
              This fixture is still a draft. It can be started once the bracket is published.
            </p>
          )}

          {(fixture.status === "POSTPONED" || fixture.status === "CANCELLED") && (
            <div className="admin-card">
              <h2 className="admin-card__title">{fixture.status === "POSTPONED" ? (resumesToLive ? "Play suspended" : "Postponed") : "Cancelled"}</h2>
              {fixture.statusReason && <p className="live-scoring__result"><small>{fixture.statusReason}</small></p>}
              {fixture.status === "CANCELLED" && (
                <p className="admin-hint">A cancelled match can't be restarted. Matches that depend on its winner can't be played until the bracket is resolved.</p>
              )}
            </div>
          )}

          {lifecycleActions.length > 0 && (
            <div className="admin-card">
              <h2 className="admin-card__title">Match status</h2>
              <div className="control__row control__row--wrap">
                {lifecycleActions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={`admin-btn ${action === "cancel" ? "admin-btn--danger" : action === "resume" ? "admin-btn--primary" : ""}`}
                    onClick={() => openLifecycle(action)}
                  >
                    {LIFECYCLE_COPY[action].verb}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {sheet?.kind === "start" && (
          <ConfirmSheet key="start" title="Start this match?" confirmLabel="Start match" onConfirm={runStart} onClose={() => setSheet(null)}>
            <p>
              {labelA} vs {labelB} will go live on the public site.
            </p>
          </ConfirmSheet>
        )}
        {sheet?.kind === "complete" && (
          <ConfirmSheet key="complete" title="Complete this match?" confirmLabel={`Confirm ${winnerLabel(sheet.winnerSlot)} wins`} onConfirm={runComplete} onClose={() => setSheet(null)}>
            <dl className="confirm-sheet__facts">
              <div>
                <dt>Result</dt>
                <dd>{sheet.summary || `${winnerLabel(sheet.winnerSlot)} wins`}</dd>
              </div>
              <div>
                <dt>Winner</dt>
                <dd>{winnerLabel(sheet.winnerSlot)}</dd>
              </div>
              <div>
                <dt>Progression</dt>
                <dd>{progression}</dd>
              </div>
            </dl>
            <p className="admin-hint">Completing locks the score. Results can still be corrected later until the next match starts.</p>
          </ConfirmSheet>
        )}
        {sheet?.kind === "walkover" && (
          <ConfirmSheet key="walkover" title="Record walkover?" tone="danger" confirmLabel={`${winnerLabel(sheet.winnerSlot)} advances`} onConfirm={runWalkover} onClose={() => setSheet(null)}>
            <dl className="confirm-sheet__facts">
              <div>
                <dt>Advances</dt>
                <dd>{winnerLabel(sheet.winnerSlot)}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{walkoverReason.trim()}</dd>
              </div>
              <div>
                <dt>Progression</dt>
                <dd>{progression}</dd>
              </div>
            </dl>
          </ConfirmSheet>
        )}
        {sheet?.kind === "lifecycle" && (
          <ConfirmSheet
            key={`lifecycle-${sheet.action}`}
            title={sheet.action === "postpone" ? "Postpone this match?" : sheet.action === "cancel" ? "Cancel this match?" : resumesToLive ? "Resume play?" : "Resume this match?"}
            tone={sheet.action === "cancel" ? "danger" : "default"}
            confirmLabel={LIFECYCLE_COPY[sheet.action].verb}
            confirmDisabled={sheet.action === "resume" ? Boolean(resumeCheck && !resumeCheck.ok) : !lifecycleReason.trim()}
            onConfirm={runLifecycle}
            onClose={() => setSheet(null)}
          >
            <p>
              {labelA} vs {labelB}
            </p>
            {sheet.action === "postpone" && (
              <p className="admin-hint">
                {fixture.status === "LIVE" ? "The score is kept and play can resume later. " : "The match returns to the schedule when you resume it. "}
                The bracket doesn't change.
              </p>
            )}
            {sheet.action === "cancel" && (
              <p className="admin-alert admin-alert--warning" role="note">
                A cancelled match can't be restarted or completed. {nextFixture ? `The winner would have advanced to Match ${nextFixture.matchNumber}, which can't be played until the bracket is resolved.` : "No later match depends on it."}
              </p>
            )}
            {sheet.action !== "resume" && (
              <label className="admin-field">
                <span className="admin-field__label">Reason (shown publicly)</span>
                <input className="admin-input" value={lifecycleReason} maxLength={REASON_MAX_LENGTH} onChange={(e) => setLifecycleReason(e.target.value)} placeholder="e.g. rain, ground unavailable" />
              </label>
            )}
            {sheet.action === "resume" && !resumesToLive && (
              <>
                <p className="admin-hint">Leave the date and time empty to keep the original schedule{fixture.scheduledDate ? ` (${when})` : ""}.</p>
                <div className="fixture-schedule__fields">
                  <label className="admin-field">
                    <span className="admin-field__label">New date</span>
                    <input className="admin-input" type="date" value={resumeDate} onChange={(e) => setResumeDate(e.target.value)} />
                  </label>
                  <label className="admin-field">
                    <span className="admin-field__label">New time</span>
                    <input className="admin-input" type="time" value={resumeTime} onChange={(e) => setResumeTime(e.target.value)} />
                  </label>
                  <label className="admin-field">
                    <span className="admin-field__label">Venue (optional)</span>
                    <input className="admin-input" value={resumeVenue} maxLength={80} onChange={(e) => setResumeVenue(e.target.value)} />
                  </label>
                </div>
                {resumeCheck && !resumeCheck.ok && (
                  <p className="admin-alert admin-alert--warning" role="alert">
                    {resumeCheck.error}
                  </p>
                )}
              </>
            )}
            {sheet.action === "resume" && resumesToLive && <p className="admin-hint">Scoring continues from the saved score.</p>}
          </ConfirmSheet>
        )}
        {sheet?.kind === "correct" && (
          <ConfirmSheet
            key="correct"
            title="Correct this result"
            tone="danger"
            confirmLabel="Apply correction"
            confirmDisabled={!correctionWinner || correctionWinner === recordedWinner || !correctionReason.trim()}
            onConfirm={runCorrection}
            onClose={() => setSheet(null)}
          >
            <p className="admin-alert admin-alert--warning" role="note">
              This changes who advances. {nextFixture ? `${winnerLabel(correctionWinner ?? (recordedWinner === "A" ? "B" : "A"))} replaces the current winner in Match ${nextFixture.matchNumber}.` : "No later match depends on it."} The correction is recorded in the audit log.
            </p>
            <div className="control__pair">
              {(["A", "B"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  aria-pressed={correctionWinner === side}
                  className={`control__tap control__tap--short ${correctionWinner === side ? "is-selected" : ""}`}
                  onClick={() => setCorrectionWinner(side)}
                >
                  <span className="control__tap-name">{winnerLabel(side)}</span>
                  <span className="control__tap-hint">{recordedWinner === side ? "Current winner" : "Make winner"}</span>
                </button>
              ))}
            </div>
            <label className="admin-field">
              <span className="admin-field__label">Reason (required)</span>
              <input className="admin-input" value={correctionReason} maxLength={500} onChange={(e) => setCorrectionReason(e.target.value)} placeholder="Why is the result being changed?" />
            </label>
          </ConfirmSheet>
        )}
      </AnimatePresence>
    </div>
  );
}
