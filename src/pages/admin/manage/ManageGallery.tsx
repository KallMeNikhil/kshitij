import { useRef, useState, type ChangeEvent } from "react";
import { AnimatePresence } from "framer-motion";
import { useSiteContentState } from "../../../hooks/useFirestoreData";
import { galleryAdd, galleryDelete, galleryReorder, gallerySetVisibility, galleryUpdate, type FocusInput } from "../../../lib/callables";
import { describeError } from "../../../lib/describeError";
import { processGalleryImage, type ProcessedImage } from "../../../lib/imageProcessing";
import { uploadMedia } from "../../../lib/mediaUpload";
import { useDragReorder } from "../../../lib/useDragReorder";
import { useOrderDraft } from "../../../lib/useOrderDraft";
import { ActionStatus, type ActionMessage } from "../../../components/admin/ActionStatus";
import { ConfirmSheet } from "../../../components/admin/ConfirmSheet";
import { FocalPointPicker } from "../../../components/admin/siteContent/FocalPointPicker";
import { ReorderControls } from "../../../components/admin/siteContent/ReorderControls";
import { ErrorState, LoadingState } from "../../../components/states/StateViews";
import { GALLERY_MAX_ITEMS } from "../../../../shared/media";
import type { GalleryItemDoc } from "../../../../shared/types";

type JobStatus = "queued" | "working" | "done" | "error";

interface UploadJob {
  id: string;
  file: File;
  status: JobStatus;
  stage: string;
  progress: number;
  error?: string;
  processed?: { full: ProcessedImage; thumb: ProcessedImage };
  fullUrl?: string;
  thumbUrl?: string;
}

type Confirm = { ids: string[]; label: string } | null;

async function uploadBoth(
  processed: { full: ProcessedImage; thumb: ProcessedImage },
  existing: { fullUrl?: string; thumbUrl?: string },
  onProgress: (fraction: number, stage: string) => void
): Promise<{ fullUrl: string; thumbUrl: string }> {
  let fullUrl = existing.fullUrl;
  let thumbUrl = existing.thumbUrl;
  if (!fullUrl) {
    const uploaded = await uploadMedia("gallery", "full", processed.full.blob, (f) => onProgress(f * 0.85, "Uploading"));
    fullUrl = uploaded.url;
  }
  if (!thumbUrl) {
    const uploaded = await uploadMedia("gallery", "thumb", processed.thumb.blob, (f) => onProgress(0.85 + f * 0.15, "Uploading"));
    thumbUrl = uploaded.url;
  }
  return { fullUrl, thumbUrl };
}

function GalleryEditor({
  item,
  label,
  busy,
  onClose,
  onSave,
  onReplace,
  onToggleVisible,
  onDelete,
}: {
  item: GalleryItemDoc;
  label: string;
  busy: boolean;
  onClose: () => void;
  onSave: (focus: FocusInput) => Promise<void>;
  onReplace: (file: File, onProgress: (fraction: number, stage: string) => void) => Promise<void>;
  onToggleVisible: () => void;
  onDelete: () => void;
}) {
  const [focus, setFocus] = useState<FocusInput>(item.focus);
  const [replacing, setReplacing] = useState<{ fraction: number; stage: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const changed = focus.x !== item.focus.x || focus.y !== item.focus.y;
  const locked = busy || replacing !== null;

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReplacing({ fraction: 0, stage: "Preparing" });
    try {
      await onReplace(file, (fraction, stage) => setReplacing({ fraction, stage }));
    } finally {
      setReplacing(null);
    }
  };

  return (
    <div className="manage-editor manage-editor--split">
      <div className="manage-editor__preview">
        <FocalPointPicker src={item.imageUrl} value={focus} label={`Focal point for ${label}`} onChange={setFocus} />
      </div>
      <div className="manage-editor__fields">
        {replacing && (
          <p className="admin-hint" role="status">
            {replacing.stage}… {Math.round(replacing.fraction * 100)}%
          </p>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="manage-file" tabIndex={-1} onChange={(e) => void pick(e)} />
        <div className="admin-actions">
          {changed && (
            <button type="button" className="admin-btn admin-btn--primary" disabled={locked} onClick={() => void onSave(focus)}>
              Save focal point
            </button>
          )}
          <button type="button" className="admin-btn" disabled={locked} onClick={() => fileRef.current?.click()}>
            Replace image
          </button>
          <button type="button" className="admin-btn" disabled={locked} onClick={onToggleVisible}>
            {item.visible ? "Hide from site" : "Show on site"}
          </button>
          <button type="button" className="admin-btn admin-btn--danger" disabled={locked} onClick={onDelete}>
            Delete
          </button>
          <button type="button" className="admin-btn" disabled={locked} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function ManageGallery() {
  const state = useSiteContentState();
  const items = state.data ? state.data.gallery : null;
  const order = useOrderDraft(items);
  const drag = useDragReorder(order.ids, order.moveTo);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [jobs, setJobs] = useState<UploadJob[]>([]);

  const jobsRef = useRef<UploadJob[]>([]);
  const pumping = useRef(false);
  const batch = useRef({ ok: 0, failed: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const total = items?.length ?? 0;
  const selectedIds = order.ordered.filter((item) => selected.has(item.id)).map((item) => item.id);
  const uploading = jobs.some((job) => job.status === "queued" || job.status === "working");

  const run = async (work: () => Promise<void>, success: string, failure: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage({ kind: "success", text: success });
    } catch (err) {
      setMessage({ kind: "error", text: `${failure} ${describeError(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const patchJob = (id: string, patch: Partial<UploadJob>) => {
    jobsRef.current = jobsRef.current.map((job) => (job.id === id ? { ...job, ...patch } : job));
    setJobs(jobsRef.current);
  };

  const runJob = async (id: string) => {
    const job = jobsRef.current.find((j) => j.id === id);
    if (!job) return;
    patchJob(id, { status: "working", stage: "Preparing", progress: 0, error: undefined });
    try {
      const processed = job.processed ?? (await processGalleryImage(job.file));
      patchJob(id, { processed });
      const urls = await uploadBoth(processed, { fullUrl: job.fullUrl, thumbUrl: job.thumbUrl }, (progress, stage) => patchJob(id, { progress, stage }));
      patchJob(id, { fullUrl: urls.fullUrl, thumbUrl: urls.thumbUrl, stage: "Saving", progress: 1 });
      await galleryAdd({
        imageUrl: urls.fullUrl,
        thumbUrl: urls.thumbUrl,
        width: processed.full.width,
        height: processed.full.height,
      });
      patchJob(id, { status: "done", stage: "Added", progress: 1, processed: undefined });
      batch.current.ok += 1;
    } catch (err) {
      patchJob(id, { status: "error", error: describeError(err) });
      batch.current.failed += 1;
    }
  };

  const pump = async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const next = jobsRef.current.find((job) => job.status === "queued");
        if (!next) break;
        await runJob(next.id);
      }
    } finally {
      pumping.current = false;
      const { ok, failed } = batch.current;
      batch.current = { ok: 0, failed: 0 };
      if (failed > 0) {
        setMessage({ kind: "error", text: `${failed} photo${failed === 1 ? "" : "s"} could not be added. Retry the failed ones.${ok > 0 ? ` ${ok} added.` : ""}` });
      } else if (ok > 0) {
        setMessage({ kind: "success", text: `${ok} photo${ok === 1 ? "" : "s"} added.` });
      }
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = GALLERY_MAX_ITEMS - total - jobsRef.current.filter((j) => j.status !== "done" && j.status !== "error").length;
    const accepted = Array.from(files).slice(0, Math.max(0, room));
    if (accepted.length < files.length) {
      setMessage({ kind: "error", text: `The gallery holds at most ${GALLERY_MAX_ITEMS} photos. ${files.length - accepted.length} file${files.length - accepted.length === 1 ? " was" : "s were"} skipped.` });
    }
    if (accepted.length === 0) return;
    const created: UploadJob[] = accepted.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "queued",
      stage: "Waiting",
      progress: 0,
    }));
    jobsRef.current = [...jobsRef.current, ...created];
    setJobs(jobsRef.current);
    void pump();
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(event.target.files);
    event.target.value = "";
  };

  const retry = (id: string) => {
    patchJob(id, { status: "queued", stage: "Waiting", error: undefined });
    void pump();
  };

  const dismissJob = (id: string) => {
    jobsRef.current = jobsRef.current.filter((job) => job.id !== id);
    setJobs(jobsRef.current);
  };

  const clearFinished = () => {
    jobsRef.current = jobsRef.current.filter((job) => job.status !== "done");
    setJobs(jobsRef.current);
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(order.ids));

  const setVisibility = (ids: string[], visible: boolean) =>
    run(
      async () => {
        await gallerySetVisibility({ ids, visible });
        setSelected(new Set());
      },
      visible ? "Now showing on the public site." : "Hidden from the public site.",
      "Could not update visibility."
    );

  const saveOrder = () =>
    run(
      async () => {
        await galleryReorder({ ids: order.ids });
      },
      "Order saved.",
      "Could not save the order."
    );

  const saveFocus = (item: GalleryItemDoc, focus: FocusInput) =>
    run(
      async () => {
        await galleryUpdate({ id: item.id, focus });
      },
      "Focal point saved.",
      "Could not save the focal point."
    );

  const replaceImage = (item: GalleryItemDoc, file: File, onProgress: (fraction: number, stage: string) => void) =>
    run(
      async () => {
        const processed = await processGalleryImage(file);
        const urls = await uploadBoth(processed, {}, onProgress);
        onProgress(1, "Saving");
        await galleryUpdate({ id: item.id, imageUrl: urls.fullUrl, thumbUrl: urls.thumbUrl, width: processed.full.width, height: processed.full.height });
      },
      "Image replaced.",
      "Could not replace the image."
    );

  const removeIds = async (ids: string[]) => {
    await galleryDelete({ ids });
    setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
    setEditingId((current) => (current && ids.includes(current) ? null : current));
    setConfirm(null);
    setMessage({ kind: "success", text: ids.length === 1 ? "Photo deleted." : "Photos deleted." });
  };

  const finished = jobs.filter((job) => job.status === "done").length;

  return (
    <>
      <section className="admin-card">
        <h2 className="admin-card__title">Add photos</h2>
        <p className="admin-hint">
          Choose several photos from your phone or take new ones. Each photo is resized on this device before it is uploaded, so large originals are fine. The Gallery section on the public site stays hidden until at least one photo is visible.
        </p>
        <input ref={fileRef} type="file" accept="image/*" multiple className="manage-file" tabIndex={-1} onChange={onPick} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="manage-file" tabIndex={-1} onChange={onPick} />
        <div className="admin-actions">
          <button type="button" className="admin-btn admin-btn--primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            Choose photos
          </button>
          <button type="button" className="admin-btn" disabled={busy} onClick={() => cameraRef.current?.click()}>
            Take a photo
          </button>
        </div>

        {jobs.length > 0 && (
          <ul className="admin-list manage-jobs" aria-label="Uploads">
            {jobs.map((job) => (
              <li key={job.id} className="manage-job" data-status={job.status}>
                <div className="manage-job__row">
                  <span className="manage-job__name">{job.file.name}</span>
                  <span className={`admin-badge ${job.status === "done" ? "admin-badge--ok" : job.status === "error" ? "admin-badge--error" : ""}`}>
                    {job.status === "error" ? "Failed" : job.stage}
                  </span>
                </div>
                {(job.status === "working" || job.status === "queued") && (
                  <div className="manage-progress" role="progressbar" aria-label={`Uploading ${job.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
                    <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
                  </div>
                )}
                {job.status === "error" && (
                  <>
                    <p className="admin-alert admin-alert--error" role="alert">
                      {job.error}
                    </p>
                    <div className="admin-actions">
                      <button type="button" className="admin-btn admin-btn--small" onClick={() => retry(job.id)}>
                        Retry
                      </button>
                      <button type="button" className="admin-btn admin-btn--small" onClick={() => dismissJob(job.id)}>
                        Dismiss
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {finished > 0 && !uploading && (
          <div className="admin-actions">
            <button type="button" className="admin-btn admin-btn--small" onClick={clearFinished}>
              Clear finished
            </button>
          </div>
        )}
      </section>

      <section className="admin-card">
        <h2 className="admin-card__title">Photos</h2>
        {state.error ? (
          <ErrorState title="The gallery couldn't be loaded" hint="Check your connection and try again." onRetry={state.retry} />
        ) : items === null ? (
          <LoadingState label="Loading photos" rows={3} />
        ) : items.length === 0 ? (
          <p className="admin-empty">No photos yet. Add some above.</p>
        ) : (
          <>
            <div className="admin-actions manage-toolbar">
              <button type="button" className="admin-btn admin-btn--small" disabled={busy} onClick={selectAll}>
                Select all
              </button>
              {selectedIds.length > 0 && (
                <>
                  <span className="admin-badge" role="status">
                    {selectedIds.length} selected
                  </span>
                  <button type="button" className="admin-btn admin-btn--small" disabled={busy} onClick={() => void setVisibility(selectedIds, false)}>
                    Hide
                  </button>
                  <button type="button" className="admin-btn admin-btn--small" disabled={busy} onClick={() => void setVisibility(selectedIds, true)}>
                    Show
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--small admin-btn--danger"
                    disabled={busy}
                    onClick={() => setConfirm({ ids: selectedIds, label: selectedIds.length === 1 ? "this photo" : "these photos" })}
                  >
                    Delete
                  </button>
                  <button type="button" className="admin-btn admin-btn--small" disabled={busy} onClick={() => setSelected(new Set())}>
                    Clear
                  </button>
                </>
              )}
            </div>

            {order.dirty && (
              <div className="admin-alert admin-alert--info manage-orderbar" role="status">
                <span>The order has changed but is not saved yet.</span>
                <div className="admin-actions">
                  <button type="button" className="admin-btn admin-btn--primary admin-btn--small" disabled={busy} onClick={() => void saveOrder()}>
                    {busy ? "Saving…" : "Save order"}
                  </button>
                  <button type="button" className="admin-btn admin-btn--small" disabled={busy} onClick={order.reset}>
                    Discard
                  </button>
                </div>
              </div>
            )}

            <ul className="admin-list manage-list" {...drag.listProps}>
              {order.ordered.map((item, index) => {
                const label = `Photo ${index + 1}`;
                return (
                  <li key={item.id} className={`manage-item${item.visible ? "" : " is-hidden"}${drag.draggingId === item.id ? " is-dragging" : ""}`}>
                    <div className="manage-item__head">
                      <label className="manage-item__check">
                        <input type="checkbox" checked={selected.has(item.id)} disabled={busy} onChange={() => toggle(item.id)} />
                        <span className="visually-hidden">Select {label}</span>
                      </label>
                      <img
                        className="manage-item__thumb"
                        src={item.thumbUrl}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        style={{ objectPosition: `${item.focus.x}% ${item.focus.y}%` }}
                      />
                      <div className="manage-item__meta">
                        <span className="manage-item__title">{label}</span>
                        <span className="admin-list__sub">
                          {item.width} × {item.height}
                        </span>
                        {!item.visible && <span className="admin-badge admin-badge--warning">Hidden</span>}
                      </div>
                    </div>
                    <ReorderControls
                      name={label}
                      index={index}
                      count={order.ordered.length}
                      disabled={busy}
                      onMove={(direction) => order.move(item.id, direction)}
                      onDragStart={(event) => drag.startDrag(event, item.id)}
                    />
                    <div className="admin-actions manage-item__actions">
                      <button type="button" className="admin-btn admin-btn--small" disabled={busy} onClick={() => setEditingId(editingId === item.id ? null : item.id)}>
                        {editingId === item.id ? "Close editor" : "Edit"}
                      </button>
                      <button type="button" className="admin-btn admin-btn--small" disabled={busy} onClick={() => void setVisibility([item.id], !item.visible)}>
                        {item.visible ? "Hide" : "Show"}
                      </button>
                    </div>
                    {editingId === item.id && (
                      <GalleryEditor
                        key={item.id}
                        item={item}
                        label={label}
                        busy={busy}
                        onClose={() => setEditingId(null)}
                        onSave={(focus) => saveFocus(item, focus)}
                        onReplace={(file, onProgress) => replaceImage(item, file, onProgress)}
                        onToggleVisible={() => void setVisibility([item.id], !item.visible)}
                        onDelete={() => setConfirm({ ids: [item.id], label: `"${label}"` })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <ActionStatus message={message} />
      </section>

      <AnimatePresence>
        {confirm && (
          <ConfirmSheet
            title="Delete from the gallery?"
            confirmLabel="Delete"
            tone="danger"
            onConfirm={() => removeIds(confirm.ids)}
            onClose={() => setConfirm(null)}
          >
            <p>This permanently removes {confirm.label} and the stored image files. It can't be undone.</p>
          </ConfirmSheet>
        )}
      </AnimatePresence>
    </>
  );
}
