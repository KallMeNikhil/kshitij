import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useCompetitions, useSports } from "../../../hooks/useFirestoreData";
import { previewPurge, purgeCompetition, type PurgePreview } from "../../../lib/callables";
import { describeError } from "../../../lib/describeError";
import { ConfirmSheet } from "../../../components/admin/ConfirmSheet";
import { ActionStatus, type ActionMessage } from "../../../components/admin/ActionStatus";

export function ManageCleanup() {
  const sports = useSports();
  const [sportId, setSportId] = useState("");
  const [competitionId, setCompetitionId] = useState("");
  const [batchId, setBatchId] = useState("");
  const competitions = useCompetitions(sportId || null, true);
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);

  const scope = { competitionId, ...(batchId.trim() ? { importBatchId: batchId.trim() } : {}) };

  const reset = () => {
    setPreview(null);
    setDownloaded(false);
    setTyped("");
  };

  const check = async () => {
    setBusy(true);
    setMessage(null);
    reset();
    try {
      const result = await previewPurge(scope);
      setPreview(result.data);
    } catch (err) {
      setMessage({ kind: "error", text: `Could not check what would be removed. ${describeError(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!preview) return;
    const blob = new Blob([JSON.stringify(preview.backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${preview.competitionId}${preview.importBatchId ? `-${preview.importBatchId}` : ""}-backup.json`;
    link.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };

  const run = async () => {
    const result = await purgeCompetition({ ...scope, confirm: typed.trim() });
    const d = result.data.deleted;
    setConfirming(false);
    reset();
    setMessage({
      kind: "success",
      text: `Removed ${d.fixtures} fixtures, ${d.teams} teams and ${d.participants} participants.${result.data.remaining > 0 ? ` ${result.data.remaining} records are left. Run the cleanup again to finish.` : ""}`,
    });
  };

  const total = preview ? preview.counts.fixtures + preview.counts.teams + preview.counts.participants : 0;

  return (
    <section className="admin-card">
      <h2 className="admin-card__title">Cleanup</h2>
      <p className="admin-hint">
        Remove the teams, participants and unpublished bracket of one competition, for example test data. Published or played fixtures are kept as history and block the cleanup. To remove only what one import created, enter its batch ID.
      </p>
      <div className="admin-card--row">
        <label className="admin-field">
          <span className="admin-field__label">Sport</span>
          <select className="admin-input" value={sportId} onChange={(e) => { setSportId(e.target.value); setCompetitionId(""); reset(); }}>
            <option value="">Select sport</option>
            {(sports ?? []).map((s) => (
              <option key={s.sportId} value={s.sportId}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span className="admin-field__label">Competition</span>
          <select className="admin-input" value={competitionId} disabled={!sportId} onChange={(e) => { setCompetitionId(e.target.value); reset(); }}>
            <option value="">Select competition</option>
            {(competitions ?? []).map((c) => (
              <option key={c.competitionId} value={c.competitionId}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="admin-field">
        <span className="admin-field__label">Import batch ID (optional)</span>
        <input className="admin-input" value={batchId} onChange={(e) => { setBatchId(e.target.value); reset(); }} placeholder="import-1760000000000" />
      </label>
      <div className="admin-actions">
        <button type="button" className="admin-btn admin-btn--primary" disabled={!competitionId || busy} onClick={() => void check()}>
          {busy ? "Checking…" : "Check what would be removed"}
        </button>
      </div>
      <ActionStatus message={message} />

      {preview && (
        <div className="admin-card">
          <p>
            {preview.counts.fixtures} fixtures · {preview.counts.teams} teams · {preview.counts.participants} participants
            {preview.importBatchId ? ` from ${preview.importBatchId}` : ""}
          </p>
          {preview.blockers.map((b) => (
            <p key={b.code} className="admin-alert admin-alert--warning" role="alert">{b.message}</p>
          ))}
          {total === 0 && preview.blockers.length === 0 && <p className="admin-empty">Nothing to remove for this selection.</p>}
          {preview.canPurge && (
            <>
              <p className="admin-hint">Download the backup first. It can be loaded again with Import (withdrawn entrants come back as active).</p>
              <div className="admin-actions">
                <button type="button" className="admin-btn" onClick={download}>Download backup</button>
              </div>
              <label className="admin-field">
                <span className="admin-field__label">Type {preview.competitionId} to confirm</span>
                <input className="admin-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </label>
              <div className="admin-actions">
                <button
                  type="button"
                  className="admin-btn admin-btn--danger"
                  disabled={!downloaded || typed.trim() !== preview.competitionId}
                  onClick={() => setConfirming(true)}
                >
                  Remove {total} records
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <AnimatePresence>
        {confirming && preview && (
          <ConfirmSheet key="purge" title="Remove these records permanently?" tone="danger" confirmLabel="Remove" onConfirm={run} onClose={() => setConfirming(false)}>
            <p>{total} records of {preview.competitionId} will be deleted. This cannot be undone except by importing the backup.</p>
          </ConfirmSheet>
        )}
      </AnimatePresence>
    </section>
  );
}
