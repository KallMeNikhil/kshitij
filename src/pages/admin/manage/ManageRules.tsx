import { useId, useState } from "react";
import { useCompetitions, useSports } from "../../../hooks/useFirestoreData";
import { updateCompetitionConfig, updateSportConfig } from "../../../lib/callables";
import { describeError } from "../../../lib/describeError";
import { ActionStatus, type ActionMessage } from "../../../components/admin/ActionStatus";
import { defaultMatchConfigurations } from "../../../../shared/matchConfig";

function pendingNotes(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as { pending?: unknown };
    return Array.isArray(parsed.pending) ? parsed.pending.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

function PendingNotice({ text }: { text: string }) {
  const notes = pendingNotes(text);
  if (notes.length === 0) return null;
  return (
    <div className="admin-alert admin-alert--warning" role="note">
      <strong>Pending rules, not yet confirmed by the coordinator</strong>
      <ul>
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

export function ManageRules() {
  const sports = useSports();
  const [sportId, setSportId] = useState("");
  const competitions = useCompetitions(sportId || null, true);
  const [competitionId, setCompetitionId] = useState("");
  const [sportText, setSportText] = useState("");
  const [competitionText, setCompetitionText] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const sportSelect = useId();
  const competitionSelect = useId();

  const seedSport = (id: string) => {
    const sport = (sports ?? []).find((s) => s.sportId === id);
    const seed = sport?.matchConfiguration ?? defaultMatchConfigurations[id] ?? null;
    setSportText(seed ? JSON.stringify(seed, null, 2) : "");
  };

  const seedCompetition = (id: string) => {
    const competition = (competitions ?? []).find((c) => c.competitionId === id);
    const sport = (sports ?? []).find((s) => s.sportId === sportId);
    const seed = competition?.matchConfiguration ?? sport?.matchConfiguration ?? defaultMatchConfigurations[sportId] ?? null;
    setCompetitionText(seed ? JSON.stringify(seed, null, 2) : "");
    setAcknowledge(false);
  };

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ kind: "success", text: `Saved ${label}.` });
    } catch (err) {
      setMessage({ kind: "error", text: `Could not save ${label}. ${describeError(err)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="admin-card admin-card--row">
        <label className="admin-field" htmlFor={sportSelect}>
          <span className="admin-field__label">Sport</span>
          <select
            id={sportSelect}
            className="admin-input"
            value={sportId}
            onChange={(e) => {
              setSportId(e.target.value);
              setCompetitionId("");
              setCompetitionText("");
              if (e.target.value) seedSport(e.target.value);
              else setSportText("");
            }}
          >
            <option value="">Select sport</option>
            {(sports ?? []).map((s) => (
              <option key={s.sportId} value={s.sportId}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="admin-field" htmlFor={competitionSelect}>
          <span className="admin-field__label">Competition</span>
          <select
            id={competitionSelect}
            className="admin-input"
            value={competitionId}
            disabled={!sportId}
            onChange={(e) => {
              setCompetitionId(e.target.value);
              if (e.target.value) seedCompetition(e.target.value);
              else setCompetitionText("");
            }}
          >
            <option value="">Select competition</option>
            {(competitions ?? []).map((c) => (
              <option key={c.competitionId} value={c.competitionId}>{c.name}</option>
            ))}
          </select>
        </label>
      </section>

      <ActionStatus message={message} />

      <section className="admin-card">
        <h2 className="admin-card__title">Sport rules</h2>
        <p className="admin-hint">Default rules for the sport. Competitions inherit them unless they set their own. Changing them never affects fixtures that already exist.</p>
        {!sportId ? (
          <p className="admin-empty">Select a sport to edit its rules.</p>
        ) : (
          <>
            <PendingNotice text={sportText} />
            <label className="admin-field">
              <span className="admin-field__label">matchConfiguration (JSON)</span>
              <textarea className="admin-input admin-input--code" rows={12} value={sportText} onChange={(e) => setSportText(e.target.value)} spellCheck={false} />
            </label>
            <div className="admin-actions">
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                disabled={busy || !sportText.trim()}
                onClick={() => void run("the sport rules", async () => updateSportConfig({ sportId, matchConfiguration: JSON.parse(sportText) }))}
              >
                Save sport rules
              </button>
            </div>
          </>
        )}
      </section>

      <section className="admin-card">
        <h2 className="admin-card__title">Competition rules</h2>
        <p className="admin-hint">Overrides the sport default for this competition only. Blocked once any fixture is scheduled, live or completed. Regenerate the bracket afterwards so draft fixtures pick up the change.</p>
        {!competitionId ? (
          <p className="admin-empty">Select a competition to edit its rules.</p>
        ) : (
          <>
            <PendingNotice text={competitionText} />
            <label className="admin-field">
              <span className="admin-field__label">matchConfiguration (JSON)</span>
              <textarea className="admin-input admin-input--code" rows={12} value={competitionText} onChange={(e) => setCompetitionText(e.target.value)} spellCheck={false} />
            </label>
            <label className="admin-check">
              <input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />
              <span>Draft fixtures already exist and I want to update the rules anyway.</span>
            </label>
            <div className="admin-actions">
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                disabled={busy || !competitionText.trim()}
                onClick={() =>
                  void run("the competition rules", async () =>
                    updateCompetitionConfig({ competitionId, matchConfiguration: JSON.parse(competitionText), acknowledgeExistingFixtures: acknowledge })
                  )
                }
              >
                Save competition rules
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
