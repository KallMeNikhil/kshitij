import type { FixtureStatus } from "../../shared/types";

const LABEL: Record<FixtureStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Upcoming",
  LIVE: "Live",
  COMPLETED: "Final",
  POSTPONED: "Postponed",
  CANCELLED: "Cancelled",
};

export function StatusBadge({ status, className }: { status: FixtureStatus; className?: string }) {
  return (
    <span className={`status-badge status-badge--${status.toLowerCase()} ${className ?? ""}`}>
      {status === "LIVE" && <span className="status-badge__dot" aria-hidden="true" />}
      {LABEL[status]}
    </span>
  );
}
