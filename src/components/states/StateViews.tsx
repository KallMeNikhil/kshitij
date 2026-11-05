import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SportIcon } from "../kshitij/SportIcon";

export function LoadingState({ label = "Loading", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="state-view state-view--loading" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="state-view__skeleton" />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, sport }: { title: string; hint?: string; sport?: string | null }) {
  return (
    <div className="state-view state-view--empty">
      {sport && (
        <span className="state-view__icon" aria-hidden="true">
          <SportIcon slug={sport} size={26} />
        </span>
      )}
      <p className="state-view__title">{title}</p>
      {hint && <p className="state-view__hint">{hint}</p>}
    </div>
  );
}

export function ErrorState({ title, hint, onRetry }: { title: string; hint?: string; onRetry?: () => void }) {
  return (
    <div className="state-view state-view--error" role="alert">
      <p className="state-view__title">{title}</p>
      {hint && <p className="state-view__hint">{hint}</p>}
      {onRetry && (
        <button type="button" className="state-view__action" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function NotFoundState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-view state-view--not-found container" id="main">
      <p className="state-view__eyebrow">404</p>
      <h1 className="state-view__heading">{title}</h1>
      {hint && <p className="state-view__hint">{hint}</p>}
      {action ?? (
        <Link to="/" className="state-view__action">
          Back to KSHITIJ
        </Link>
      )}
    </div>
  );
}
