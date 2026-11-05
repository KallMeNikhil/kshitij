import { useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useEntityDocsState } from "../../../hooks/useAdminFixtures";
import { useCompetitions, useSports } from "../../../hooks/useFirestoreData";
import { deleteEntity, deleteEntities, upsertEntity, withdrawEntrants, type BulkOutcome } from "../../../lib/callables";
import { Segmented } from "../../../components/Segmented";
import { ConfirmSheet } from "../../../components/admin/ConfirmSheet";
import { ActionStatus, type ActionMessage } from "../../../components/admin/ActionStatus";
import { ErrorState, LoadingState } from "../../../components/states/StateViews";
import { RecordForm } from "../../../components/admin/RecordForm";

type Kind = "sports" | "competitions" | "teams" | "participants";

const ID_FIELD: Record<Kind, string> = { sports: "sportId", competitions: "competitionId", teams: "teamId", participants: "participantId" };
const KINDS: { value: Kind; label: string }[] = [
  { value: "sports", label: "Sports" },
  { value: "competitions", label: "Competitions" },
  { value: "teams", label: "Teams" },
  { value: "participants", label: "Participants" },
];

function labelOf(kind: Kind, doc: Record<string, unknown>): { title: string; sub: string } {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (kind === "sports") return { title: s(doc.name), sub: s(doc.scoringModel) };
  if (kind === "competitions") return { title: s(doc.name), sub: doc.published ? "Published" : "Not published" };
  if (kind === "teams") return { title: s(doc.teamName) || s(doc.college), sub: s(doc.college) };
  return { title: s(doc.name), sub: s(doc.college) };
}

export function ManageEntities() {
  const sports = useSports();
  const [kind, setKind] = useState<Kind>("sports");
  const [sportId, setSportId] = useState("");
  const [competitionId, setCompetitionId] = useState("");
  const competitions = useCompetitions(sportId || null, true);
  const needsCompetition = kind === "teams" || kind === "participants";
  const docsState = useEntityDocsState(kind, competitionId || null);
  const docs = docsState.data;
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [editMode, setEditMode] = useState<"form" | "json">("form");
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"delete" | "withdraw" | null>(null);
  const [bulkReason, setBulkReason] = useState("");
  const bulkKind = kind === "teams" || kind === "participants" ? kind : null;

  const guardsConfig = kind === "sports" || kind === "competitions";
  const rows = useMemo(
    () =>
      (docs ?? [])
        .map((d) => ({ id: String(d[ID_FIELD[kind]]), doc: d, ...labelOf(kind, d) }))
        .filter((r) => !filter || `${r.title} ${r.sub}`.toLowerCase().includes(filter.toLowerCase()))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [docs, kind, filter]
  );

  const open = (id: string, doc: Record<string, unknown>) => {
    const copy = { ...doc };
    if (guardsConfig) delete copy.matchConfiguration;
    setEditMode("form");
    setEditing({ id, text: JSON.stringify(copy, null, 2) });
  };

  const parsed = (() => {
    if (!editing) return null;
    try {
      const v = JSON.parse(editing.text);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  })();

  const save = async () => {
    if (!editing || !parsed) return;
    const data = { ...parsed };
    if (guardsConfig) delete data.matchConfiguration;
    await upsertEntity({ collection: kind, id: editing.id, data });
    setMessage({ kind: "success", text: `Saved ${editing.id}.` });
    setEditing(null);
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const describeOutcomes = (items: BulkOutcome[]) =>
    items.length === 0 ? "" : ` Skipped ${items.length}: ${items.slice(0, 5).map((i) => `${i.id} (${i.message})`).join(", ")}${items.length > 5 ? "…" : ""}.`;

  const runBulk = async () => {
    if (!bulk || !bulkKind || !competitionId) return;
    const ids = [...selected];
    if (bulk === "delete") {
      const result = await deleteEntities({ collection: bulkKind, competitionId, ids });
      setMessage({ kind: result.data.deleted.length > 0 ? "success" : "error", text: `Deleted ${result.data.deleted.length} of ${ids.length}.${describeOutcomes(result.data.blocked)}` });
    } else {
      const result = await withdrawEntrants({ collection: bulkKind, competitionId, ids, reason: bulkReason.trim() });
      setMessage({
        kind: result.data.withdrawn.length > 0 ? "success" : "error",
        text: `Withdrew ${result.data.withdrawn.length} of ${ids.length}.${result.data.affectedFixtureIds.length > 0 ? ` ${result.data.affectedFixtureIds.length} open fixtures need a walkover.` : ""}${describeOutcomes(result.data.skipped)}`,
      });
    }
    setSelected(new Set());
    setBulkReason("");
    setBulk(null);
  };

  const remove = async () => {
    if (!deleting) return;
    await deleteEntity({ collection: kind, id: deleting.id });
    setMessage({ kind: "success", text: `Deleted ${deleting.title || deleting.id}.` });
    setDeleting(null);
  };

  return (
    <section className="admin-card">
      <h2 className="admin-card__title">Event data</h2>
      <p className="admin-hint">Edit or remove existing records. The server validates every change and refuses ones that would break fixtures. To add many records at once, use Import.</p>

      <Segmented aria-label="Record type" skin="pill" options={KINDS} value={kind} onChange={(v) => { setKind(v as Kind); setFilter(""); setMessage(null); setSelected(new Set()); }} />

      {needsCompetition && (
        <div className="admin-card--row">
          <label className="admin-field">
            <span className="admin-field__label">Sport</span>
            <select className="admin-input" value={sportId} onChange={(e) => { setSportId(e.target.value); setCompetitionId(""); setSelected(new Set()); }}>
              <option value="">Select sport</option>
              {(sports ?? []).map((s) => (
                <option key={s.sportId} value={s.sportId}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Competition</span>
            <select className="admin-input" value={competitionId} disabled={!sportId} onChange={(e) => { setCompetitionId(e.target.value); setSelected(new Set()); }}>
              <option value="">Select competition</option>
              {(competitions ?? []).map((c) => (
                <option key={c.competitionId} value={c.competitionId}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <ActionStatus message={message} />

      {needsCompetition && !competitionId ? (
        <p className="admin-empty">Choose a sport and competition to list its {kind}.</p>
      ) : docsState.error ? (
        <ErrorState title="Records couldn't be loaded" hint="Check your connection and try again." onRetry={docsState.retry} />
      ) : docs === null ? (
        <LoadingState label="Loading records" rows={3} />
      ) : (
        <>
          {docs.length > 8 && (
            <input className="admin-input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name" aria-label="Filter records" />
          )}
          {bulkKind && rows.length > 0 && (
            <div className="admin-actions">
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={rows.every((r) => selected.has(r.id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
                <span>Select all shown</span>
              </label>
              <button type="button" className="admin-btn admin-btn--small" disabled={selected.size === 0} onClick={() => { setBulkReason(""); setBulk("withdraw"); }}>
                Withdraw selected ({selected.size})
              </button>
              <button type="button" className="admin-btn admin-btn--small admin-btn--danger" disabled={selected.size === 0} onClick={() => setBulk("delete")}>
                Delete selected ({selected.size})
              </button>
            </div>
          )}
          {rows.length === 0 ? (
            <p className="admin-empty">No records.</p>
          ) : (
            <ul className="admin-list admin-list--rich">
              {rows.map((r) => (
                <li key={r.id}>
                  {bulkKind && (
                    <label className="admin-check">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.title || r.id}`} />
                    </label>
                  )}
                  <div className="admin-list__main">
                    <span className="admin-list__title">{r.title || r.id}</span>
                    {r.sub && <span className="admin-list__sub">{r.sub}</span>}
                  </div>
                  <button type="button" className="admin-btn admin-btn--small" onClick={() => open(r.id, r.doc)}>Edit</button>
                  <button type="button" className="admin-btn admin-btn--small admin-btn--danger" onClick={() => setDeleting({ id: r.id, title: r.title })}>Delete</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <AnimatePresence>
        {editing && (
          <ConfirmSheet key="edit" title={`Edit ${editing.id}`} confirmLabel="Save changes" confirmDisabled={!parsed} onConfirm={save} onClose={() => setEditing(null)}>
            <Segmented
              aria-label="Editor"
              skin="pill"
              options={[
                { value: "form", label: "Form" },
                { value: "json", label: "JSON" },
              ]}
              value={editMode}
              onChange={(v) => setEditMode(v as "form" | "json")}
            />
            {editMode === "form" && parsed ? (
              <RecordForm record={parsed} idField={ID_FIELD[kind]} onChange={(next) => setEditing({ ...editing, text: JSON.stringify(next, null, 2) })} />
            ) : (
              <label className="admin-field">
                <span className="admin-field__label">Record (JSON)</span>
                <textarea className="admin-input admin-input--code" rows={14} value={editing.text} spellCheck={false} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
              </label>
            )}
            {!parsed && <p className="admin-alert admin-alert--warning" role="alert">This isn't a valid JSON object yet{editMode === "form" ? ", so the form can't show it. Fix it in the JSON tab." : "."}</p>}
            {guardsConfig && <p className="admin-hint">Match rules are edited under Rules, not here.</p>}
          </ConfirmSheet>
        )}
        {bulk === "delete" && (
          <ConfirmSheet key="bulk-delete" title={`Delete ${selected.size} ${kind}?`} tone="danger" confirmLabel="Delete" onConfirm={runBulk} onClose={() => setBulk(null)}>
            <p>This removes the selected records permanently. Ones seated in fixtures or on teams are skipped and listed afterwards.</p>
          </ConfirmSheet>
        )}
        {bulk === "withdraw" && (
          <ConfirmSheet key="bulk-withdraw" title={`Withdraw ${selected.size} ${kind}?`} confirmLabel="Withdraw" confirmDisabled={bulkReason.trim().length === 0} onConfirm={runBulk} onClose={() => setBulk(null)}>
            <label className="admin-field">
              <span className="admin-field__label">Reason</span>
              <input className="admin-input" value={bulkReason} maxLength={500} onChange={(e) => setBulkReason(e.target.value)} />
            </label>
            <p className="admin-hint">Withdrawn entrants can't be restored and can't be recorded as winners.</p>
          </ConfirmSheet>
        )}
        {deleting && (
          <ConfirmSheet key="delete" title={`Delete ${deleting.title || deleting.id}?`} tone="danger" confirmLabel="Delete" onConfirm={remove} onClose={() => setDeleting(null)}>
            <p>This removes the record permanently. The server refuses if fixtures or other records still depend on it.</p>
          </ConfirmSheet>
        )}
      </AnimatePresence>
    </section>
  );
}
