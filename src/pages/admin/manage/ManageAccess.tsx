import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useAdminsState } from "../../../hooks/useAdminFixtures";
import { useSports } from "../../../hooks/useFirestoreData";
import { manageAdmin } from "../../../lib/callables";
import { ConfirmSheet } from "../../../components/admin/ConfirmSheet";
import { ActionStatus, type ActionMessage } from "../../../components/admin/ActionStatus";
import { ErrorState, LoadingState } from "../../../components/states/StateViews";
import type { AdminDoc, AdminRole } from "../../../../shared/types";

interface Draft {
  email: string;
  displayName: string;
  role: AdminRole;
  sportIds: string[];
  active: boolean;
  isNew: boolean;
}

const blank: Draft = { email: "", displayName: "", role: "SPORT_COORDINATOR", sportIds: [], active: true, isNew: true };

export function ManageAccess() {
  const adminsState = useAdminsState();
  const admins = adminsState.data;
  const sports = useSports();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<ActionMessage | null>(null);

  const edit = (a: AdminDoc) =>
    setDraft({ email: a.email, displayName: a.displayName ?? "", role: a.role, sportIds: a.sportIds, active: a.active, isNew: false });

  const sportName = (id: string) => sports?.find((s) => s.sportId === id)?.name ?? id;

  const protectedAccount = draft?.role === "SUPER_ADMIN";
  const valid = draft && /.+@.+\..+/.test(draft.email) && (protectedAccount || draft.sportIds.length > 0);

  const save = async () => {
    if (!draft) return;
    await manageAdmin({
      email: draft.email.trim(),
      ...(draft.displayName.trim() ? { displayName: draft.displayName.trim() } : {}),
      role: draft.role,
      ...(draft.role === "SPORT_COORDINATOR" ? { sportIds: draft.sportIds } : {}),
      active: draft.active,
    });
    setMessage({ kind: "success", text: `${draft.isNew ? "Added" : "Updated"} ${draft.email.trim().toLowerCase()}.` });
    setDraft(null);
  };

  return (
    <section className="admin-card">
      <div className="admin-card__head">
        <h2 className="admin-card__title">People and access</h2>
        <button type="button" className="admin-btn admin-btn--primary admin-btn--small" onClick={() => setDraft(blank)}>
          Add person
        </button>
      </div>
      <ActionStatus message={message} />
      {adminsState.error ? (
        <ErrorState title="People couldn't be loaded" hint="Check your connection and try again." onRetry={adminsState.retry} />
      ) : admins === null ? (
        <LoadingState label="Loading admins" rows={3} />
      ) : (
        <ul className="admin-list admin-list--rich">
          {admins.map((a) => (
            <li key={a.email}>
              <div className="admin-list__main">
                <span className="admin-list__title">{a.displayName ?? a.email}</span>
                {a.displayName && <span className="admin-list__sub">{a.email}</span>}
                <span className="admin-list__sub">
                  {a.role === "SUPER_ADMIN" ? "Super Admin" : `Coordinator · ${a.sportIds.map(sportName).join(", ") || "no sports"}`}
                </span>
              </div>
              <span className={`admin-badge ${a.active ? "admin-badge--ok" : ""}`}>{a.active ? "Active" : "Inactive"}</span>
              <button type="button" className="admin-btn admin-btn--small" onClick={() => edit(a)}>
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}

      <AnimatePresence>
        {draft && (
          <ConfirmSheet
            key="access"
            title={draft.isNew ? "Add person" : "Edit access"}
            confirmLabel="Save"
            confirmDisabled={!valid}
            tone={!draft.active ? "danger" : "default"}
            onConfirm={save}
            onClose={() => setDraft(null)}
          >
            <label className="admin-field">
              <span className="admin-field__label">Email</span>
              <input className="admin-input" type="email" value={draft.email} disabled={!draft.isNew} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="kshitij@gmail.com" />
            </label>
            <label className="admin-field">
              <span className="admin-field__label">Display name (optional)</span>
              <input className="admin-input" value={draft.displayName} maxLength={80} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
            </label>
            <p className="admin-hint">{protectedAccount ? "Super Admin. There is only one, and this account's role and access cannot be changed." : "Sport Coordinators run live scores and results for their assigned sports."}</p>
            {!protectedAccount && (
              <fieldset className="admin-fieldset">
                <legend className="admin-field__label">Assigned sports</legend>
                <div className="admin-checks">
                  {(sports ?? []).map((s) => (
                    <label key={s.sportId} className="admin-check">
                      <input
                        type="checkbox"
                        checked={draft.sportIds.includes(s.sportId)}
                        onChange={(e) =>
                          setDraft({ ...draft, sportIds: e.target.checked ? [...draft.sportIds, s.sportId] : draft.sportIds.filter((id) => id !== s.sportId) })
                        }
                      />
                      <span>{s.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {!protectedAccount && (
              <label className="admin-check">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                <span>Active</span>
              </label>
            )}
          </ConfirmSheet>
        )}
      </AnimatePresence>
    </section>
  );
}
