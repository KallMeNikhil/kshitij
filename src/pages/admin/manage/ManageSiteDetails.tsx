import { useEffect, useState } from "react";
import { useSiteContentState } from "../../../hooks/useFirestoreData";
import { detailsUpdate } from "../../../lib/callables";
import { describeError } from "../../../lib/describeError";
import { siteContent } from "../../../config/siteContent";
import { ActionStatus, type ActionMessage } from "../../../components/admin/ActionStatus";
import { ErrorState, LoadingState } from "../../../components/states/StateViews";
import { SITE_TEXT_LIMITS } from "../../../../shared/schemas";
import type { SiteDetailsDoc } from "../../../../shared/types";

interface Form {
  eventLabel: string;
  tagline: string;
  footerNote: string;
  heroTitle: string;
  email: string;
  phone: string;
}

function fromDoc(details: SiteDetailsDoc | null): Form {
  return {
    eventLabel: details?.eventLabel ?? "",
    tagline: details?.tagline ?? "",
    footerNote: details?.footerNote ?? "",
    heroTitle: details?.heroTitle ?? "",
    email: details?.contact?.email ?? "",
    phone: details?.contact?.phone ?? "",
  };
}

export function ManageSiteDetails() {
  const state = useSiteContentState();
  const details = state.data ? state.data.details : undefined;
  const [form, setForm] = useState<Form>(fromDoc(null));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);

  useEffect(() => {
    if (details === undefined || touched) return;
    setForm(fromDoc(details));
  }, [details, touched]);

  const set = (key: keyof Form, value: string) => {
    setTouched(true);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await detailsUpdate({
        eventLabel: form.eventLabel.trim(),
        tagline: form.tagline.trim(),
        footerNote: form.footerNote.trim(),
        heroTitle: form.heroTitle.trim(),
        contact: { email: form.email.trim(), phone: form.phone.trim() },
      });
      setTouched(false);
      setMessage({ kind: "success", text: "Site details saved." });
    } catch (err) {
      setMessage({ kind: "error", text: `Could not save the details. ${describeError(err)}` });
    } finally {
      setBusy(false);
    }
  };

  if (state.error) {
    return (
      <section className="admin-card">
        <h2 className="admin-card__title">Site details</h2>
        <ErrorState title="The site details couldn't be loaded" hint="Check your connection and try again." onRetry={state.retry} />
      </section>
    );
  }

  if (details === undefined) {
    return (
      <section className="admin-card">
        <h2 className="admin-card__title">Site details</h2>
        <LoadingState label="Loading site details" rows={3} />
      </section>
    );
  }

  return (
    <section className="admin-card manage-form manage-form--grid">
      <h2 className="admin-card__title">Site details</h2>
      <p className="admin-hint">Leave a field empty to use the default. The footer shows only the contact fields that are filled in, and no contact block when both are empty.</p>
      <label className="admin-field">
        <span className="admin-field__label">Event label</span>
        <input className="admin-input" value={form.eventLabel} placeholder={siteContent.eventLabel} maxLength={SITE_TEXT_LIMITS.eventLabel} disabled={busy} onChange={(e) => set("eventLabel", e.target.value)} />
      </label>
      <label className="admin-field">
        <span className="admin-field__label">Tagline</span>
        <input className="admin-input" value={form.tagline} placeholder={siteContent.tagline} maxLength={SITE_TEXT_LIMITS.tagline} disabled={busy} onChange={(e) => set("tagline", e.target.value)} />
      </label>
      <label className="admin-field">
        <span className="admin-field__label">Footer note</span>
        <input className="admin-input" value={form.footerNote} placeholder={siteContent.footerNote} maxLength={SITE_TEXT_LIMITS.footerNote} disabled={busy} onChange={(e) => set("footerNote", e.target.value)} />
      </label>
      <label className="admin-field">
        <span className="admin-field__label">Hero title (read by screen readers)</span>
        <input className="admin-input" value={form.heroTitle} placeholder={siteContent.heroTitle} maxLength={SITE_TEXT_LIMITS.heroTitle} disabled={busy} onChange={(e) => set("heroTitle", e.target.value)} />
      </label>
      <label className="admin-field">
        <span className="admin-field__label">Contact email</span>
        <input className="admin-input" type="email" inputMode="email" autoComplete="off" value={form.email} maxLength={SITE_TEXT_LIMITS.email} disabled={busy} onChange={(e) => set("email", e.target.value)} />
      </label>
      <label className="admin-field">
        <span className="admin-field__label">Contact phone</span>
        <input className="admin-input" type="tel" inputMode="tel" autoComplete="off" value={form.phone} maxLength={SITE_TEXT_LIMITS.phone} disabled={busy} onChange={(e) => set("phone", e.target.value)} />
      </label>
      <ActionStatus message={message} />
      <div className="admin-actions">
        <button type="button" className="admin-btn admin-btn--primary" disabled={busy || !touched} onClick={() => void save()}>
          {busy ? "Saving…" : "Save details"}
        </button>
      </div>
    </section>
  );
}
