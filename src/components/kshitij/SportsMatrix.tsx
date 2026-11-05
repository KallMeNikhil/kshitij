import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import { getSportMeta } from "./sportMeta";
import { SportIcon } from "./SportIcon";
import { SectionHeading } from "./SectionHeading";
import { usePointerSheen } from "../../hooks/usePointerSheen";
import { formatDateTime } from "../../lib/format";
import type { FixtureDoc, SportDoc } from "../../../shared/types";

function SportCell({
  sport,
  liveCount,
  next,
}: {
  sport: SportDoc;
  liveCount: number;
  next: FixtureDoc | null;
}) {
  const meta = getSportMeta(sport.slug);
  const { ref, ...sheen } = usePointerSheen<HTMLAnchorElement>();
  const isLive = liveCount > 0;
  const nextWhen = next ? formatDateTime(next.scheduledDate, next.scheduledTime) : null;

  return (
    <Link
      to={`/sports/${sport.slug}`}
      className={`sport-cell ${isLive ? "is-live" : ""}`}
      style={{ "--sport-accent": meta.accent, "--sport-accent-soft": meta.accentSoft } as CSSProperties}
      ref={ref}
      {...sheen}
    >
      <span className="sport-cell__sheen" aria-hidden="true" />
      <span className="sport-cell__rule" aria-hidden="true" />
      <span className="sport-cell__glyph" aria-hidden="true">
        <SportIcon slug={sport.slug} size={56} />
      </span>
      <span className="sport-cell__top">
        <SportIcon slug={sport.slug} size={18} />
        {isLive && <span className="sport-cell__live-dot" aria-hidden="true" />}
      </span>
      <span className="sport-cell__name">{sport.name}</span>
      <span className={`sport-cell__meta ${isLive ? "is-live" : ""}`}>
        {isLive ? `${liveCount} live now` : nextWhen ? `Next · ${nextWhen}` : "View fixtures"}
      </span>
    </Link>
  );
}

export function SportsMatrix({
  sports,
  liveFixtures,
  upcomingFixtures,
}: {
  sports: SportDoc[] | null;
  liveFixtures: FixtureDoc[] | null;
  upcomingFixtures: FixtureDoc[] | null;
}) {
  if (!sports || sports.length === 0) return null;

  const liveBySport = new Map<string, number>();
  (liveFixtures ?? []).forEach((f) => liveBySport.set(f.sportId, (liveBySport.get(f.sportId) ?? 0) + 1));
  const nextBySport = new Map<string, FixtureDoc>();
  for (const f of upcomingFixtures ?? []) {
    if (!nextBySport.has(f.sportId)) nextBySport.set(f.sportId, f);
  }

  const twoColFillers = sports.length % 2;
  const threeColFillers = (3 - (sports.length % 3)) % 3;

  return (
    <section className="home-section" id="sports">
      <div className="container">
        <SectionHeading
          title="The sports"
          lead="Choose your arena."
        />
        <div className="sports-matrix">
          {sports.map((s) => (
            <SportCell key={s.sportId} sport={s} liveCount={liveBySport.get(s.sportId) ?? 0} next={nextBySport.get(s.sportId) ?? null} />
          ))}
          {Array.from({ length: twoColFillers }, (_, i) => (
            <span key={`f2-${i}`} className="sport-cell sport-cell--filler sport-cell--filler-2" aria-hidden="true" />
          ))}
          {Array.from({ length: threeColFillers }, (_, i) => (
            <span key={`f3-${i}`} className="sport-cell sport-cell--filler sport-cell--filler-3" aria-hidden="true" />
          ))}
        </div>
      </div>
    </section>
  );
}
