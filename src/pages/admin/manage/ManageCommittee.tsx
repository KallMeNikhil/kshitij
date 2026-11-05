import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { AnimatePresence } from "framer-motion";
import { useSiteContentState } from "../../../hooks/useFirestoreData";
import {
  committeeAdd,
  committeeDelete,
  committeeRemovePhoto,
  committeeReorder,
  committeeSetVisibility,
  committeeUpdate,
  type FocusInput,
} from "../../../lib/callables";
import { describeError } from "../../../lib/describeError";
import { processPortrait, type ProcessedImage } from "../../../lib/imageProcessing";
import { uploadMedia } from "../../../lib/mediaUpload";
import { useDragReorder } from "../../../lib/useDragReorder";
import { useOrderDraft } from "../../../lib/useOrderDraft";
import { ActionStatus, type ActionMessage } from "../../../components/admin/ActionStatus";
import { ConfirmSheet } from "../../../components/admin/ConfirmSheet";
import { FocalPointPicker } from "../../../components/admin/siteContent/FocalPointPicker";
import { ReorderControls } from "../../../components/admin/siteContent/ReorderControls";
import { CommitteeSwitch } from "../../../components/kshitij/CommitteeSwitch";
import { ErrorState, LoadingState } from "../../../components/states/StateViews";
import { COMMITTEE_CATEGORIES, COMMITTEE_CATEGORY_HINTS, COMMITTEE_CATEGORY_LABELS, COMMITTEE_MAX_MEMBERS, type CommitteeCategory } from "../../../../shared/media";
import { SITE_TEXT_LIMITS } from "../../../../shared/schemas";
import type { CommitteeMemberDoc } from "../../../../shared/types";

interface MemberPatch {
  name: string;
  role: string;
  category: CommitteeCategory;
  featured: boolean;
  focus: FocusInput;
}

function CategorySelect({ value, disabled, onChange }: { value: CommitteeCategory; disabled: boolean; onChange: (value: CommitteeCategory) => void }) {
  return (
    <label className="admin-field">
      <span className="admin-field__label">Section</span>
      <select className="admin-input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as CommitteeCategory)}>
        {COMMITTEE_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {COMMITTEE_CATEGORY_HINTS[category]}
          </option>
        ))}
      </select>
    </label>
  );
}

interface PendingPhoto {
  processed: ProcessedImage;
  previewUrl: string;
  uploadedUrl?: string;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function Avatar({ member }: { member: CommitteeMemberDoc }) {
  if (member.photoUrl) {
    return (
      <img
        className="manage-item__thumb manage-item__thumb--portrait"
        src={member.photoUrl}
        alt=""
        loading="lazy"
        draggable={false}
        style={{ objectPosition: `${member.focus.x}% ${member.focus.y}%` }}
      />
    );
  }
  return (
    <span className="manage-item__thumb manage-item__thumb--portrait manage-item__monogram" aria-hidden="true">
      {initials(member.name)}
    </span>
  );
}

function MemberEditor({
  member,
  busy,
  onClose,
  onSave,
  onReplacePhoto,
  onRemovePhoto,
  onToggleVisible,
  onDelete,
}: {
  member: CommitteeMemberDoc;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: MemberPatch) => Promise<void>;
  onReplacePhoto: (file: File, onProgress: (fraction: number, stage: string) => void) => Promise<void>;
  onRemovePhoto: () => void;
  onToggleVisible: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role);
  const [category, setCategory] = useState<CommitteeCategory>(member.category);
  const [featured, setFeatured] = useState(member.featured);
  const [focus, setFocus] = useState<FocusInput>(member.focus);
  const [replacing, setReplacing] = useState<{ fraction: number; stage: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const changed =
    name !== member.name ||
    role !== member.role ||
    category !== member.category ||
    featured !== member.featured ||
    focus.x !== member.focus.x ||
    focus.y !== member.focus.y;
  const locked = busy || replacing !== null;
  const valid = name.trim().length > 0 && role.trim().length > 0;

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReplacing({ fraction: 0, stage: "Preparing" });
    try {
      await onReplacePhoto(file, (fraction, stage) => setReplacing({ fraction, stage }));
    } finally {
      setReplacing(null);
    }
  };

  return (
    <div className={`manage-editor${member.photoUrl ? " manage-editor--split" : ""}`}>
      {member.photoUrl && (
        <div className="manage-editor__preview">
          <FocalPointPicker src={member.photoUrl} value={focus} label={`Focal point for ${member.name}`} onChange={setFocus} />
        </div>
      )}
      <div className="manage-editor__fields">
      <label className="admin-field">
        <span className="admin-field__label">Name</span>
        <input className="admin-input" value={name} maxLength={SITE_TEXT_LIMITS.name} disabled={locked} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="admin-field">
        <span className="admin-field__label">Designation</span>
        <input className="admin-input" value={role} maxLength={SITE_TEXT_LIMITS.role} disabled={locked} onChange={(e) => setRole(e.target.value)} />
      </label>
      <CategorySelect value={category} disabled={locked} onChange={setCategory} />
      <label className="admin-check">
        <input type="checkbox" checked={featured} disabled={locked} onChange={(e) => setFeatured(e.target.checked)} />
        <span>Featured (highlighted card on the public site)</span>
      </label>
      {replacing && (
        <p className="admin-hint" role="status">
          {replacing.stage}… {Math.round(replacing.fraction * 100)}%
        </p>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="manage-file" tabIndex={-1} onChange={(e) => void pick(e)} />
      <div className="admin-actions">
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          disabled={locked || !changed || !valid}
          onClick={() => void onSave({ name, role, category, featured, focus })}
        >
          Save changes
        </button>
        <button type="button" className="admin-btn" disabled={locked} onClick={() => fileRef.current?.click()}>
          {member.photoUrl ? "Replace photo" : "Add photo"}
        </button>
        {member.photoUrl && (
          <button type="button" className="admin-btn" disabled={locked} onClick={onRemovePhoto}>
            Remove photo
          </button>
        )}
        <button type="button" className="admin-btn" disabled={locked} onClick={onToggleVisible}>
          {member.visible ? "Hide from site" : "Show on site"}
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

export function ManageCommittee() {
  const state = useSiteContentState();
  const members = state.data ? state.data.committee : null;
  const order = useOrderDraft(members);
  const [tab, setTab] = useState<CommitteeCategory>("faculty");
  const catMembers = order.ordered.filter((member) => member.category === tab);
  const catIds = catMembers.map((member) => member.id);
  const moveWithin = (id: string, index: number) => {
    const target = catIds[Math.max(0, Math.min(catIds.length - 1, index))];
    if (target !== undefined) order.moveTo(id, order.ids.indexOf(target));
  };
  const moveInCategory = (id: string, direction: "up" | "down" | "top" | "bottom") => {
    const from = catIds.indexOf(id);
    if (from < 0) return;
    const to = direction === "up" ? from - 1 : direction === "down" ? from + 1 : direction === "top" ? 0 : catIds.length - 1;
    moveWithin(id, to);
  };
  const drag = useDragReorder(catIds, moveWithin);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "delete"; member: CommitteeMemberDoc } | { kind: "photo"; member: CommitteeMemberDoc } | null>(null);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [category, setCategory] = useState<CommitteeCategory>("coordinator");
  const [featured, setFeatured] = useState(false);
  const [photo, setPhoto] = useState<PendingPhoto | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [progress, setProgress] = useState<{ fraction: number; stage: string } | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);

  const total = members?.length ?? 0;
  const full = total >= COMMITTEE_MAX_MEMBERS;
  const canAdd = name.trim().length > 0 && role.trim().length > 0 && !busy && !photoBusy && !full;

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    []
  );

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

  const clearPhoto = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPhoto(null);
  };

  const choosePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    setMessage(null);
    try {
      const processed = await processPortrait(file);
      clearPhoto();
      const previewUrl = URL.createObjectURL(processed.blob);
      previewRef.current = previewUrl;
      setPhoto({ processed, previewUrl });
    } catch (err) {
      setMessage({ kind: "error", text: `Could not read that photo. ${describeError(err)}` });
    } finally {
      setPhotoBusy(false);
    }
  };

  const addMember = () =>
    run(
      async () => {
        let photoUrl = photo?.uploadedUrl;
        if (photo && !photoUrl) {
          setProgress({ fraction: 0, stage: "Uploading" });
          try {
            const uploaded = await uploadMedia("committee", "photo", photo.processed.blob, (fraction) => setProgress({ fraction, stage: "Uploading" }));
            photoUrl = uploaded.url;
            setPhoto({ ...photo, uploadedUrl: uploaded.url });
          } finally {
            setProgress(null);
          }
        }
        await committeeAdd({
          name: name.trim(),
          role: role.trim(),
          category,
          featured,
          ...(photoUrl ? { photoUrl } : {}),
        });
        setTab(category);
        setName("");
        setRole("");
        setFeatured(false);
        clearPhoto();
      },
      "Member added.",
      "Could not add the member."
    );

  const saveOrder = () =>
    run(
      async () => {
        await committeeReorder({ ids: order.ids });
      },
      "Order saved.",
      "Could not save the order."
    );

  const setVisible = (member: CommitteeMemberDoc, visible: boolean) =>
    run(
      async () => {
        await committeeSetVisibility({ ids: [member.id], visible });
      },
      visible ? "Now showing on the public site." : "Hidden from the public site.",
      "Could not update visibility."
    );

  const saveEdits = (member: CommitteeMemberDoc, patch: MemberPatch) =>
    run(
      async () => {
        await committeeUpdate({
          id: member.id,
          name: patch.name.trim(),
          role: patch.role.trim(),
          category: patch.category,
          featured: patch.featured,
          focus: patch.focus,
        });
        setTab(patch.category);
      },
      "Member saved.",
      "Could not save the member."
    );

  const replacePhoto = (member: CommitteeMemberDoc, file: File, onProgress: (fraction: number, stage: string) => void) =>
    run(
      async () => {
        const processed = await processPortrait(file);
        const uploaded = await uploadMedia("committee", "photo", processed.blob, (fraction) => onProgress(fraction, "Uploading"));
        onProgress(1, "Saving");
        await committeeUpdate({ id: member.id, photoUrl: uploaded.url });
      },
      "Photo updated.",
      "Could not update the photo."
    );

  const removePhoto = async (member: CommitteeMemberDoc) => {
    await committeeRemovePhoto({ id: member.id });
    setConfirm(null);
    setMessage({ kind: "success", text: "Photo removed." });
  };

  const removeMember = async (member: CommitteeMemberDoc) => {
    await committeeDelete({ ids: [member.id] });
    setEditingId((current) => (current === member.id ? null : current));
    setConfirm(null);
    setMessage({ kind: "success", text: "Member deleted." });
  };

  return (
    <>
      <section className="admin-card manage-form">
        <h2 className="admin-card__title">Add a member</h2>
        <p className="admin-hint">Without a photo the public card shows the member's initials. Pick the section the member belongs to. The Organizing committee section stays hidden until at least one member is visible.</p>
        <label className="admin-field">
          <span className="admin-field__label">Name</span>
          <input className="admin-input" value={name} maxLength={SITE_TEXT_LIMITS.name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="admin-field">
          <span className="admin-field__label">Designation</span>
          <input className="admin-input" value={role} maxLength={SITE_TEXT_LIMITS.role} disabled={busy} onChange={(e) => setRole(e.target.value)} />
        </label>
        <CategorySelect value={category} disabled={busy} onChange={setCategory} />
        <label className="admin-check">
          <input type="checkbox" checked={featured} disabled={busy} onChange={(e) => setFeatured(e.target.checked)} />
          <span>Featured (highlighted card on the public site)</span>
        </label>
        <input ref={photoRef} type="file" accept="image/*" className="manage-file" tabIndex={-1} onChange={(e) => void choosePhoto(e)} />
        {photo && <img className="manage-preview" src={photo.previewUrl} alt="Selected portrait preview" />}
        {progress && (
          <div className="manage-progress" role="progressbar" aria-label="Uploading photo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)}>
            <span style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
          </div>
        )}
        <div className="admin-actions">
          <button type="button" className="admin-btn" disabled={busy || photoBusy} onClick={() => photoRef.current?.click()}>
            {photoBusy ? "Preparing photo…" : photo ? "Choose a different photo" : "Choose photo (optional)"}
          </button>
          {photo && (
            <button type="button" className="admin-btn" disabled={busy} onClick={clearPhoto}>
              Remove photo
            </button>
          )}
        </div>
        <div className="admin-actions">
          <button type="button" className="admin-btn admin-btn--primary" disabled={!canAdd} onClick={() => void addMember()}>
            {busy ? "Adding…" : "Add member"}
          </button>
        </div>
        {full && <p className="admin-hint">The committee holds at most {COMMITTEE_MAX_MEMBERS} members.</p>}
      </section>

      <section className="admin-card">
        <h2 className="admin-card__title">Members</h2>
        {state.error ? (
          <ErrorState title="The committee couldn't be loaded" hint="Check your connection and try again." onRetry={state.retry} />
        ) : members === null ? (
          <LoadingState label="Loading members" rows={3} />
        ) : members.length === 0 ? (
          <p className="admin-empty">No members yet. Add one above.</p>
        ) : (
          <>
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

            <CommitteeSwitch
              className="cswitch--admin"
              label="Committee section"
              value={tab}
              onChange={(value) => setTab(value as CommitteeCategory)}
              options={COMMITTEE_CATEGORIES.map((category) => ({
                value: category,
                label: COMMITTEE_CATEGORY_LABELS[category],
              }))}
            />

            {catMembers.length === 0 && <p className="admin-empty">No members in this section.</p>}

            <ul className="admin-list manage-list" {...drag.listProps}>
              {catMembers.map((member, index) => (
                <li key={member.id} className={`manage-item${member.visible ? "" : " is-hidden"}${drag.draggingId === member.id ? " is-dragging" : ""}`}>
                  <div className="manage-item__head">
                    <Avatar member={member} />
                    <div className="manage-item__meta">
                      <span className="manage-item__title">{member.name}</span>
                      <span className="admin-list__sub">{member.role}</span>
                      <span className="manage-item__badges">
                        {member.featured && <span className="admin-badge admin-badge--ok">Featured</span>}
                        {!member.visible && <span className="admin-badge admin-badge--warning">Hidden</span>}
                      </span>
                    </div>
                  </div>
                  <ReorderControls
                    name={member.name}
                    index={index}
                    count={catMembers.length}
                    disabled={busy}
                    onMove={(direction) => moveInCategory(member.id, direction)}
                    onDragStart={(event) => drag.startDrag(event, member.id)}
                  />
                  <div className="admin-actions manage-item__actions">
                    <button type="button" className="admin-btn admin-btn--small" disabled={busy} onClick={() => setEditingId(editingId === member.id ? null : member.id)}>
                      {editingId === member.id ? "Close editor" : "Edit"}
                    </button>
                    <button type="button" className="admin-btn admin-btn--small" disabled={busy} onClick={() => void setVisible(member, !member.visible)}>
                      {member.visible ? "Hide" : "Show"}
                    </button>
                  </div>
                  {editingId === member.id && (
                    <MemberEditor
                      key={member.id}
                      member={member}
                      busy={busy}
                      onClose={() => setEditingId(null)}
                      onSave={(patch) => saveEdits(member, patch)}
                      onReplacePhoto={(file, onProgress) => replacePhoto(member, file, onProgress)}
                      onRemovePhoto={() => setConfirm({ kind: "photo", member })}
                      onToggleVisible={() => void setVisible(member, !member.visible)}
                      onDelete={() => setConfirm({ kind: "delete", member })}
                    />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <ActionStatus message={message} />
      </section>

      <AnimatePresence>
        {confirm && (
          <ConfirmSheet
            title={confirm.kind === "delete" ? "Delete this member?" : "Remove this photo?"}
            confirmLabel={confirm.kind === "delete" ? "Delete" : "Remove photo"}
            tone="danger"
            onConfirm={() => (confirm.kind === "delete" ? removeMember(confirm.member) : removePhoto(confirm.member))}
            onClose={() => setConfirm(null)}
          >
            <p>
              {confirm.kind === "delete"
                ? `${confirm.member.name} is removed from the committee and any stored photo is deleted. It can't be undone.`
                : `The stored photo of ${confirm.member.name} is deleted and the card falls back to initials.`}
            </p>
          </ConfirmSheet>
        )}
      </AnimatePresence>
    </>
  );
}
