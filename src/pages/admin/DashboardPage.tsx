import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminScope } from "../../lib/useAdminScope";
import { useAdminFixtures, useAllCompetitions, useRoundTotalsFrom } from "../../hooks/useAdminFixtures";
import { AdminFixtureList } from "../../components/admin/AdminFixtureList";
import { ErrorState, LoadingState } from "../../components/states/StateViews";
import { NEEDS_ACTION_LABEL, needsAction, scheduledAt, suspendedFixtures } from "../../lib/needsAction";

function Panel({ title, count, tone, children }: { title: string; count?: number; tone?: "live"; children: React.ReactNode }) {
  return (
    <section className={`admin-panel ${tone ? `admin-panel--${tone}` : ""}`}>
      <h2 className="admin-panel__title">
        {title}
        {count !== undefined && count > 0 && <span className="admin-panel__count">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { isSuper, scopedSports, sportIds, sports, sportsLoading, sportsError, retrySports } = useAdminScope();
  const { fixtures, loading, error, retry } = useAdminFixtures(sportIds);
  const competitions = useAllCompetitions();
  const roundTotals = useRoundTotalsFrom(fixtures);

  const groups = useMemo(() => {
    const live = fixtures.filter((f) => f.status === "LIVE");
    const upcoming = fixtures
      .filter((f) => f.status === "SCHEDULED" && scheduledAt(f))
      .sort((a, b) => (scheduledAt(a)!.getTime() - scheduledAt(b)!.getTime()))
      .slice(0, 8);
    const completed = fixtures
      .filter((f) => f.status === "COMPLETED" && f.slotA.kind !== "BYE" && f.slotB.kind !== "BYE")
      .sort((a, b) => `${b.scheduledDate ?? ""}${b.scheduledTime ?? ""}`.localeCompare(`${a.scheduledDate ?? ""}${a.scheduledTime ?? ""}`) || b.round - a.round)
      .slice(0, 6);
    return { live, upcoming, completed, action: needsAction(fixtures), suspended: suspendedFixtures(fixtures) };
  }, [fixtures]);

  if (sportsError) return <ErrorState title="Sports couldn't be loaded" hint="Check your connection and try again." onRetry={retrySports} />;
  if (error) return <ErrorState title="Fixtures couldn't be loaded" hint="Check your connection and try again." onRetry={retry} />;
  if (sportsLoading || loading) return <LoadingState label="Loading dashboard" rows={4} />;

  const open = (id: string) => navigate(`/admin/fixtures/${id}/live`);
  const common = { sports, competitions, roundTotals, showSport: isSuper || scopedSports.length > 1, onOpen: open };

  if (sportIds.length === 0) {
    return (
      <div className="admin-page">
        <h1 className="admin-page__title">Dashboard</h1>
        <p className="admin-empty">No sports are assigned to this account yet.</p>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <h1 className="admin-page__title">Dashboard</h1>

      <div className="admin-dashboard">
        <Panel title="Live now" count={groups.live.length} tone="live">
          <AdminFixtureList {...common} fixtures={groups.live} emptyText="Nothing is live right now." />
        </Panel>

        <Panel title="Needs action" count={groups.action.length}>
          {groups.action.length === 0 ? (
            <p className="admin-empty">Nothing needs attention.</p>
          ) : (
            <AdminFixtureList
              {...common}
              fixtures={groups.action.map((a) => a.fixture)}
              emptyText=""
              renderExtra={(f) => {
                const item = groups.action.find((a) => a.fixture.fixtureId === f.fixtureId);
                return item ? <p className={`admin-flag admin-flag--${item.kind.toLowerCase()}`}>{NEEDS_ACTION_LABEL[item.kind]}</p> : null;
              }}
            />
          )}
        </Panel>

        <Panel title="Upcoming" count={groups.upcoming.length}>
          <AdminFixtureList {...common} fixtures={groups.upcoming} emptyText="No scheduled matches yet." />
        </Panel>

        <Panel title="Postponed and cancelled" count={groups.suspended.length}>
          <AdminFixtureList
            {...common}
            fixtures={groups.suspended}
            emptyText="No postponed or cancelled matches."
            renderExtra={(f) => (
              <p className={`admin-flag admin-flag--${f.status === "CANCELLED" ? "cancelled" : "postponed"}`}>
                {f.status === "CANCELLED" ? "Cancelled" : f.resumeStatus === "LIVE" ? "Play suspended" : "Postponed"}
                {f.statusReason ? ` · ${f.statusReason}` : ""}
              </p>
            )}
          />
        </Panel>

        <Panel title="Recently completed" count={groups.completed.length}>
          <AdminFixtureList {...common} fixtures={groups.completed} emptyText="No completed matches yet." />
        </Panel>
      </div>
    </div>
  );
}
