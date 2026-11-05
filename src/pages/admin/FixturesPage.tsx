import { useMemo, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAdminScope } from "../../lib/useAdminScope";
import { useAdminFixtures, useAllCompetitions, useRoundTotalsFrom } from "../../hooks/useAdminFixtures";
import { Segmented } from "../../components/Segmented";
import { AdminFixtureList } from "../../components/admin/AdminFixtureList";
import { FixtureScheduleEditor } from "../../components/admin/FixtureScheduleEditor";
import { getSportMeta } from "../../components/kshitij/sportMeta";
import { SportIcon } from "../../components/kshitij/SportIcon";
import { ErrorState, LoadingState } from "../../components/states/StateViews";
import type { FixtureDoc } from "../../../shared/types";

type Filter = "live" | "upcoming" | "draft" | "completed" | "other";
const FILTERS: Filter[] = ["live", "upcoming", "draft", "completed", "other"];

const matches = (f: FixtureDoc, filter: Filter) =>
  filter === "live"
    ? f.status === "LIVE"
    : filter === "upcoming"
      ? f.status === "SCHEDULED"
      : filter === "draft"
        ? f.status === "DRAFT"
        : filter === "completed"
          ? f.status === "COMPLETED"
          : f.status === "POSTPONED" || f.status === "CANCELLED";

function sidewaysScroll(el: HTMLDivElement | null) {
  if (!el) return;
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  };
  const onPointerDown = (down: PointerEvent) => {
    if (down.pointerType !== "mouse" || down.button !== 0 || el.scrollWidth <= el.clientWidth) return;
    const startX = down.clientX;
    const startLeft = el.scrollLeft;
    let moved = false;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 4) {
        moved = true;
        el.classList.add("is-dragging");
      }
      if (moved) el.scrollLeft = startLeft - dx;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.classList.remove("is-dragging");
      if (!moved) return;
      const swallow = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      el.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => el.removeEventListener("click", swallow, true), 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("pointerdown", onPointerDown);
  return () => {
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("pointerdown", onPointerDown);
  };
}

export function FixturesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { isSuper, scopedSports, sportIds, sports, sportsLoading, sportsError, retrySports } = useAdminScope();
  const { fixtures, loading, error, retry } = useAdminFixtures(sportIds);
  const competitions = useAllCompetitions();
  const roundTotals = useRoundTotalsFrom(fixtures);

  const rawFilter = params.get("status") as Filter | null;
  const filter: Filter = rawFilter && FILTERS.includes(rawFilter) ? rawFilter : "live";
  const requestedSport = params.get("sport");
  const sportFilter = requestedSport && sportIds.includes(requestedSport) ? requestedSport : null;
  const competitionFilter = params.get("comp");

  const update = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    setParams(next, { replace: true });
  };

  const inSport = useMemo(() => (sportFilter ? fixtures.filter((f) => f.sportId === sportFilter) : fixtures), [fixtures, sportFilter]);
  const sportCompetitions = useMemo(
    () => (competitions ?? []).filter((c) => (sportFilter ? c.sportId === sportFilter : sportIds.includes(c.sportId))).sort((a, b) => a.displayOrder - b.displayOrder),
    [competitions, sportFilter, sportIds]
  );
  const inScope = useMemo(
    () => (competitionFilter && sportCompetitions.some((c) => c.competitionId === competitionFilter) ? inSport.filter((f) => f.competitionId === competitionFilter) : inSport),
    [inSport, competitionFilter, sportCompetitions]
  );

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((k) => [k, inScope.filter((f) => matches(f, k)).length])) as Record<Filter, number>, [inScope]);
  const list = useMemo(
    () => inScope.filter((f) => matches(f, filter)).sort((a, b) => a.sportId.localeCompare(b.sportId) || a.competitionId.localeCompare(b.competitionId) || a.round - b.round || a.matchNumber - b.matchNumber),
    [inScope, filter]
  );

  if (sportsError) return <ErrorState title="Sports couldn't be loaded" hint="Check your connection and try again." onRetry={retrySports} />;
  if (error) return <ErrorState title="Fixtures couldn't be loaded" hint="Check your connection and try again." onRetry={retry} />;
  if (sportsLoading || loading) return <LoadingState label="Loading fixtures" rows={4} />;

  return (
    <div className="admin-page">
      <h1 className="admin-page__title">{isSuper ? "Fixtures" : "My fixtures"}</h1>

      {scopedSports.length > 1 && (
        <div ref={sidewaysScroll} className="admin-chips overflow-x-scroll" role="group" aria-label="Sport">
          <button type="button" aria-pressed={!sportFilter} className={!sportFilter ? "is-active" : ""} onClick={() => update((n) => { n.delete("sport"); n.delete("comp"); })}>
            All sports
          </button>
          {scopedSports.map((s) => (
            <button
              key={s.sportId}
              type="button"
              aria-pressed={sportFilter === s.sportId}
              className={sportFilter === s.sportId ? "is-active" : ""}
              style={{ "--sport-accent": getSportMeta(s.slug).accent } as CSSProperties}
              onClick={() => update((n) => { n.set("sport", s.sportId); n.delete("comp"); })}
            >
              <SportIcon slug={s.slug} size={14} />
              {s.name}
            </button>
          ))}
        </div>
      )}

      {sportCompetitions.length > 1 && (
        <label className="admin-field admin-field--inline">
          <span className="admin-field__label">Competition</span>
          <select className="admin-input" value={competitionFilter ?? ""} onChange={(e) => update((n) => (e.target.value ? n.set("comp", e.target.value) : n.delete("comp")))}>
            <option value="">All competitions</option>
            {sportCompetitions.map((c) => (
              <option key={c.competitionId} value={c.competitionId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <Segmented
        aria-label="Status"
        skin="pill"
        className="admin-status-tabs"
        options={[
          { value: "live", label: "Live", count: counts.live },
          { value: "upcoming", label: "Upcoming", count: counts.upcoming },
          { value: "draft", label: "Draft", count: counts.draft },
          { value: "completed", label: "Completed", count: counts.completed },
          { value: "other", label: "Postponed / cancelled", count: counts.other },
        ]}
        value={filter}
        onChange={(v) => update((n) => n.set("status", v))}
      />

      <AdminFixtureList
        fixtures={list}
        sports={sports}
        competitions={competitions}
        roundTotals={roundTotals}
        showSport={scopedSports.length > 1}
        onOpen={(id) => navigate(`/admin/fixtures/${id}/live`)}
        emptyText={`No ${filter === "other" ? "postponed or cancelled" : filter} matches.`}
        renderExtra={(f) => <FixtureScheduleEditor fixture={f} />}
      />
    </div>
  );
}
