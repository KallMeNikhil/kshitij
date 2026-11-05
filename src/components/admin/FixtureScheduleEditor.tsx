import { useId, useState } from "react";
import { saveFixture } from "../../lib/callables";
import { describeError } from "../../lib/describeError";
import { formatDateTime } from "../../lib/format";
import { checkScheduleDraft, isSchedulable, VENUE_MAX_LENGTH, type ScheduleDraft } from "../../../shared/schedule";
import type { FixtureDoc } from "../../../shared/types";

const draftFrom = (f: FixtureDoc): ScheduleDraft => ({
  date: f.scheduledDate ?? "",
  time: f.scheduledTime ?? "",
  venue: f.venue ?? "",
});

export function FixtureScheduleEditor({ fixture }: { fixture: FixtureDoc }) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftFrom(fixture));
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  if (!isSchedulable(fixture.status)) return null;

  const current = draftFrom(fixture);
  const check = checkScheduleDraft(draft);
  const unchanged = draft.date === current.date && draft.time === current.time && draft.venue.trim() === current.venue;
  const touched = draft.date !== "" || draft.time !== "";
  const hasSchedule = Boolean(fixture.scheduledDate && fixture.scheduledTime);

  const begin = () => {
    setDraft(draftFrom(fixture));
    setErrorMessage("");
    setNotice("");
    setOpen(true);
  };

  const save = async () => {
    if (!check.ok) return;
    setBusy(true);
    setErrorMessage("");
    try {
      await saveFixture({ fixtureId: fixture.fixtureId, ...check.value });
      setOpen(false);
      setNotice("Schedule saved.");
    } catch (err) {
      setErrorMessage(`Could not save schedule — ${describeError(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixture-schedule">
      {!open && (
        <div className="fixture-schedule__summary">
          <span className="fixture-schedule__current">
            {hasSchedule ? [formatDateTime(fixture.scheduledDate, fixture.scheduledTime), fixture.venue].filter(Boolean).join(" · ") : "Not scheduled yet"}
          </span>
          <button type="button" className="admin-btn admin-btn--small" onClick={begin}>
            {hasSchedule ? "Reschedule" : "Set schedule"}
          </button>
        </div>
      )}
      {!open && notice && (
        <p className="admin-alert admin-alert--success" role="status">
          {notice}
        </p>
      )}

      {open && (
        <div className="fixture-schedule__panel" role="group" aria-label="Edit schedule">
          {fixture.status === "DRAFT" && (
            <p className="fixture-schedule__hint">
              This fixture is a draft. The schedule is saved now, but the fixture stays hidden until the bracket is published.
            </p>
          )}
          <div className="fixture-schedule__fields">
            <label htmlFor={`${ids}-date`} className="admin-field">
              <span className="admin-field__label">Date</span>
              <input className="admin-input" id={`${ids}-date`} type="date" value={draft.date} disabled={busy} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </label>
            <label htmlFor={`${ids}-time`} className="admin-field">
              <span className="admin-field__label">Time</span>
              <input className="admin-input" id={`${ids}-time`} type="time" value={draft.time} disabled={busy} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
            </label>
            <label htmlFor={`${ids}-venue`} className="admin-field">
              <span className="admin-field__label">Venue (optional)</span>
              <input
                className="admin-input"
                id={`${ids}-venue`}
                type="text"
                value={draft.venue}
                maxLength={VENUE_MAX_LENGTH}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, venue: e.target.value })}
              />
            </label>
          </div>

          {touched && !check.ok && (
            <p className="admin-alert admin-alert--warning" role="alert">
              {check.error}
            </p>
          )}
          {errorMessage && (
            <p className="admin-alert admin-alert--error" role="alert">
              {errorMessage}
            </p>
          )}

          <div className="fixture-schedule__actions">
            <button type="button" className="admin-btn admin-btn--primary" disabled={busy || !check.ok || unchanged} onClick={() => void save()}>
              {busy ? "Saving…" : "Save schedule"}
            </button>
            <button type="button" className="admin-btn" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
