import { useAuditLogsState } from "../../../hooks/useFirestoreData";
import { ErrorState, LoadingState } from "../../../components/states/StateViews";

export function ManageAudit() {
  const logsState = useAuditLogsState(50);
  const logs = logsState.data;
  return (
    <section className="admin-card">
      <h2 className="admin-card__title">Audit log</h2>
      <p className="admin-hint">The 50 most recent consequential operations, newest first.</p>
      {logsState.error ? (
        <ErrorState title="The audit log couldn't be loaded" hint="Check your connection and try again." onRetry={logsState.retry} />
      ) : logs === null ? (
        <LoadingState label="Loading audit log" rows={3} />
      ) : logs.length === 0 ? (
        <p className="admin-empty">No audit entries yet.</p>
      ) : (
        <ul className="admin-list admin-list--rich audit-list">
          {logs.map((entry) => (
            <li key={entry.id}>
              <details>
                <summary>
                  <span className="audit-list__action">{entry.action}</span>
                  <span className="admin-list__sub">
                    {entry.targetType}: {entry.targetId}
                  </span>
                  <span className="admin-list__sub">
                    {entry.actorEmail}
                    {entry.actorRole ? ` (${entry.actorRole === "SUPER_ADMIN" ? "Super Admin" : "Coordinator"})` : ""} · {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </summary>
                {entry.reason && <p>Reason: {entry.reason}</p>}
                <pre>{JSON.stringify({ before: entry.before ?? null, after: entry.after ?? null }, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
