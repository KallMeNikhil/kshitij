import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { previewImport, commitImport } from "../../lib/callables";
import { describeError } from "../../lib/describeError";
import { ActionStatus, type ActionMessage } from "../../components/admin/ActionStatus";
import type { ImportPreview } from "../../../shared/import-validator";
import type { CanonicalImport } from "../../../shared/schemas";

type Step = "upload" | "preview" | "result";

const COUNT_GROUPS: { title: string; rows: { key: keyof ImportPreview["counts"]; label: string }[] }[] = [
  {
    title: "Participants",
    rows: [
      { key: "newParticipants", label: "New" },
      { key: "updatedParticipants", label: "Updated" },
      { key: "unchangedParticipants", label: "Unchanged" },
    ],
  },
  {
    title: "Teams",
    rows: [
      { key: "newTeams", label: "New" },
      { key: "updatedTeams", label: "Updated" },
      { key: "unchangedTeams", label: "Unchanged" },
    ],
  },
  {
    title: "Sports and competitions",
    rows: [
      { key: "newSports", label: "New sports" },
      { key: "newCompetitions", label: "New competitions" },
      { key: "updatedCompetitions", label: "Updated competitions" },
    ],
  },
  {
    title: "Fixtures",
    rows: [
      { key: "newFixtures", label: "New" },
      { key: "updatedFixtures", label: "Updated" },
      { key: "skippedProtectedFixtures", label: "Skipped (protected)" },
    ],
  },
];

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "preview", label: "Preview" },
  { id: "result", label: "Result" },
];

export function ImportPage() {
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<unknown>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const errors = useMemo(() => preview?.issues.filter((i) => i.severity === "error") ?? [], [preview]);
  const warnings = useMemo(() => preview?.issues.filter((i) => i.severity === "warning") ?? [], [preview]);

  const reset = () => {
    setStep("upload");
    setPreview(null);
    setParsed(null);
    setConfirmed(false);
    setMessage(null);
    setFileName("");
  };

  const loadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setMessage({ kind: "error", text: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Import files can be up to 2 MB.` });
      return;
    }
    try {
      setRaw(await file.text());
      setFileName(file.name);
      setMessage(null);
    } catch {
      setMessage({ kind: "error", text: "That file couldn't be read. Try again or paste the JSON instead." });
    }
  };

  const runPreview = async () => {
    setBusy(true);
    setMessage(null);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (err) {
      setMessage({ kind: "error", text: `This isn't valid JSON. ${err instanceof Error ? err.message : ""}`.trim() });
      setBusy(false);
      return;
    }
    try {
      const result = await previewImport(value);
      setParsed(value);
      setPreview(result.data);
      setConfirmed(false);
      setStep("preview");
    } catch (err) {
      setMessage({ kind: "error", text: `Could not preview the import. ${describeError(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const runCommit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await commitImport(parsed as CanonicalImport);
      setPreview(result.data);
      setBatchId(result.data.importBatchId);
      setStep("result");
    } catch (err) {
      setMessage({ kind: "error", text: `Could not commit the import. Nothing was confirmed as saved. ${describeError(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="admin-page">
      <h1 className="admin-page__title">Import</h1>

      <ol className="admin-steps" aria-label="Import progress">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i === stepIndex ? "is-current" : i < stepIndex ? "is-done" : ""} aria-current={i === stepIndex ? "step" : undefined}>
            <span>{i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <section className="admin-card">
          <div className="admin-actions">
            <input ref={fileInput} type="file" accept=".json,application/json" className="visually-hidden" onChange={(e) => void loadFile(e)} aria-label="Upload a JSON file" tabIndex={-1} />
            <button type="button" className="admin-btn" onClick={() => fileInput.current?.click()}>
              Upload JSON file
            </button>
            {fileName && <span className="admin-hint">Loaded {fileName}. You can still edit it below.</span>}
          </div>
          <label className="admin-field">
            <span className="admin-field__label">Canonical JSON (or paste it here)</span>
            <textarea
              className="admin-input admin-input--code"
              rows={14}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              spellCheck={false}
              placeholder='{ "schemaVersion": "kshitij.canonical/1", ... }'
            />
          </label>
          <ActionStatus message={message} />
          <div className="admin-actions">
            <button type="button" className="admin-btn admin-btn--primary" disabled={busy || !raw.trim()} onClick={() => void runPreview()}>
              {busy ? "Checking…" : "Validate and preview"}
            </button>
          </div>
        </section>
      )}

      {step !== "upload" && preview && (
        <>
          <section className="admin-card">
            <h2 className="admin-card__title">
              {step === "result" ? "Imported" : "Preview"}
              {errors.length > 0 && <span className="admin-badge admin-badge--error">{errors.length} error{errors.length === 1 ? "" : "s"}</span>}
              {warnings.length > 0 && <span className="admin-badge admin-badge--warning">{warnings.length} warning{warnings.length === 1 ? "" : "s"}</span>}
              {errors.length === 0 && <span className="admin-badge admin-badge--ok">Passed validation</span>}
            </h2>
            <div className="import-counts">
              {COUNT_GROUPS.map((g) => (
                <div key={g.title} className="import-counts__group">
                  <h3>{g.title}</h3>
                  <dl>
                    {g.rows.map((r) => (
                      <div key={r.key}>
                        <dt>{r.label}</dt>
                        <dd>{preview.counts[r.key]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>

          {preview.issues.length > 0 && (
            <section className="admin-card">
              <h2 className="admin-card__title">Issues</h2>
              <ul className="import-issues">
                {[...errors, ...warnings].map((issue, i) => (
                  <li key={i} className={`import-issues__item import-issues__item--${issue.severity}`}>
                    <span className="import-issues__code">{issue.severity === "error" ? "Error" : "Warning"} · {issue.code}</span>
                    <span className="import-issues__message">{issue.message}</span>
                    {issue.path && <code className="import-issues__path">{issue.path}</code>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {step === "preview" && (
            <section className="admin-card">
              <ActionStatus message={message} />
              {errors.length > 0 ? (
                <p className="admin-alert admin-alert--error" role="alert">
                  Fix the errors in your JSON and validate again. Nothing can be committed while errors remain.
                </p>
              ) : (
                <label className="admin-check">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  <span>I've reviewed the changes above and want to write them to the live event data.</span>
                </label>
              )}
              <div className="admin-actions">
                <button type="button" className="admin-btn" disabled={busy} onClick={() => setStep("upload")}>
                  Edit JSON
                </button>
                <button type="button" className="admin-btn admin-btn--primary" disabled={busy || errors.length > 0 || !confirmed} onClick={() => void runCommit()}>
                  {busy ? "Committing…" : "Commit import"}
                </button>
              </div>
            </section>
          )}

          {step === "result" && (
            <section className="admin-card">
              <p className="admin-alert admin-alert--success" role="status">
                Import committed. The counts above are what the server reported.
              </p>
              {batchId && <p className="admin-hint">Import batch: <code>{batchId}</code>. New records from this import carry it, so it can be removed later under Manage › Cleanup.</p>}
              <div className="admin-actions">
                <button type="button" className="admin-btn" onClick={() => { reset(); setRaw(""); }}>
                  Start another import
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
