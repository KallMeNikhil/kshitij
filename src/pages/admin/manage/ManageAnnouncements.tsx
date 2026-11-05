import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useAnnouncementsState, useSports } from "../../../hooks/useFirestoreData";
import { createAnnouncement, deleteAnnouncement } from "../../../lib/callables";
import { describeError } from "../../../lib/describeError";
import { ActionStatus, type ActionMessage } from "../../../components/admin/ActionStatus";
import { ConfirmSheet } from "../../../components/admin/ConfirmSheet";
import { ErrorState, LoadingState } from "../../../components/states/StateViews";

export function ManageAnnouncements() {
  const sports = useSports();
  const announcementsState = useAnnouncementsState(50);
  const announcements = announcementsState.data;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sportId, setSportId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const [listMessage, setListMessage] = useState<ActionMessage | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  const publish = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await createAnnouncement({ title: title.trim(), body: body.trim(), ...(sportId ? { sportId } : {}) });
      setTitle("");
      setBody("");
      setSportId("");
      setMessage({ kind: "success", text: "Announcement published on the public site." });
    } catch (err) {
      setMessage({ kind: "error", text: `Could not publish. ${describeError(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setListMessage(null);
    await deleteAnnouncement({ id });
    setPendingDelete(null);
    setListMessage({ kind: "success", text: "Announcement deleted." });
  };

  return (
    <>
      <section className="admin-card">
        <h2 className="admin-card__title">New announcement</h2>
        <p className="admin-hint">Announcements go live on the public site as soon as they are published. They can be deleted later but not edited.</p>
        <label className="admin-field">
          <span className="admin-field__label">Title</span>
          <input className="admin-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="admin-field">
          <span className="admin-field__label">Message</span>
          <textarea className="admin-input" rows={4} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
        </label>
        <label className="admin-field">
          <span className="admin-field__label">Sport (optional)</span>
          <select className="admin-input" value={sportId} onChange={(e) => setSportId(e.target.value)}>
            <option value="">All sports</option>
            {(sports ?? []).map((s) => (
              <option key={s.sportId} value={s.sportId}>{s.name}</option>
            ))}
          </select>
        </label>
        <ActionStatus message={message} />
        <div className="admin-actions">
          <button type="button" className="admin-btn admin-btn--primary" disabled={busy || !title.trim() || !body.trim()} onClick={() => void publish()}>
            {busy ? "Publishing…" : "Publish announcement"}
          </button>
        </div>
      </section>

      <section className="admin-card">
        <h2 className="admin-card__title">Published</h2>
        {announcementsState.error ? (
          <ErrorState title="Announcements couldn't be loaded" hint="Check your connection and try again." onRetry={announcementsState.retry} />
        ) : announcements === null ? (
          <LoadingState label="Loading announcements" rows={2} />
        ) : announcements.length === 0 ? (
          <p className="admin-empty">No announcements yet.</p>
        ) : (
          <ul className="admin-list admin-list--rich">
            {announcements.map((a) => (
              <li key={a.announcementId}>
                <div className="admin-list__main">
                  <span className="admin-list__title">{a.title}</span>
                  <span className="admin-list__sub">{a.body}</span>
                  <span className="admin-list__sub">
                    {a.sportId ? sports?.find((s) => s.sportId === a.sportId)?.name ?? a.sportId : "All sports"} · {new Date(a.createdAt).toLocaleString()}
                  </span>
                </div>
                <button type="button" className="admin-btn admin-btn--small admin-btn--danger" onClick={() => setPendingDelete({ id: a.announcementId, title: a.title })}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <ActionStatus message={listMessage} />
      </section>

      <AnimatePresence>
        {pendingDelete && (
          <ConfirmSheet
            title="Delete this announcement?"
            confirmLabel="Delete"
            tone="danger"
            onConfirm={() => remove(pendingDelete.id)}
            onClose={() => setPendingDelete(null)}
          >
            <p>"{pendingDelete.title}" is removed from the public site straight away. It can't be undone.</p>
          </ConfirmSheet>
        )}
      </AnimatePresence>
    </>
  );
}
