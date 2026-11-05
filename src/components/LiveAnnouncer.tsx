import { useEffect, useRef, useState } from "react";
import { useResolvedSlot } from "../hooks/useEntity";
import { usePublicLive, usePublicLiveStates, usePublicSports } from "../lib/PublicDataContext";
import { compactScore } from "../lib/scoreSummary";
import { tryResolveScoringModel } from "../../shared/scoring/registry";
import type { FixtureDoc, MatchStateDoc, SportDoc } from "../../shared/types";

const FLUSH_DELAY_MS = 600;
const CLEAR_DELAY_MS = 8000;

function Watcher({
  fixture,
  state,
  sport,
  ready,
  onMessage,
}: {
  fixture: FixtureDoc;
  state: MatchStateDoc | null | undefined;
  sport: SportDoc | undefined;
  ready: boolean;
  onMessage: (text: string) => void;
}) {
  const a = useResolvedSlot(fixture.slotA);
  const b = useResolvedSlot(fixture.slotB);
  const last = useRef<string | null>(null);
  const announcedLive = useRef(false);

  useEffect(() => {
    if (!a || !b || state === undefined) return;
    const names = `${a.label} versus ${b.label}`;
    const model = tryResolveScoringModel(fixture, sport);
    const score = model && compactScore(model, state, false, fixture.matchConfigurationSnapshot ?? sport?.matchConfiguration ?? null);
    const signature = score ? `${score.a}|${score.b}` : "none";

    if (last.current === null) {
      last.current = signature;
      if (ready && !announcedLive.current) onMessage(`${sport?.name ? `${sport.name}: ` : ""}${names} is now live.`);
      announcedLive.current = true;
      return;
    }
    if (signature !== last.current) {
      last.current = signature;
      if (score) onMessage(`${names}: ${score.a} to ${score.b}.`);
    }
  }, [a, b, state, fixture, sport, ready, onMessage]);

  return null;
}

export function LiveAnnouncer() {
  const live = usePublicLive();
  const sports = usePublicSports();
  const states = usePublicLiveStates();
  const [message, setMessage] = useState("");
  const queue = useRef<string[]>([]);
  const flushTimer = useRef<number | undefined>(undefined);
  const clearTimer = useRef<number | undefined>(undefined);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (live !== null && states !== null && !ready) {
      const t = window.setTimeout(() => setReady(true), 1500);
      return () => window.clearTimeout(t);
    }
  }, [live, states, ready]);

  const push = useRef((text: string) => {
    if (!queue.current.includes(text)) queue.current.push(text);
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      setMessage(queue.current.join(" "));
      queue.current = [];
      window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => setMessage(""), CLEAR_DELAY_MS);
    }, FLUSH_DELAY_MS);
  }).current;

  useEffect(
    () => () => {
      window.clearTimeout(flushTimer.current);
      window.clearTimeout(clearTimer.current);
    },
    []
  );

  return (
    <>
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
      {(live ?? []).map((f) => (
        <Watcher
          key={f.fixtureId}
          fixture={f}
          state={states ? states.get(f.fixtureId) ?? null : undefined}
          sport={sports?.find((s) => s.sportId === f.sportId)}
          ready={ready}
          onMessage={push}
        />
      ))}
    </>
  );
}
