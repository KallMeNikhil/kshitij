import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useListener } from "./useFirestoreData";
import type { AdminDoc, CompetitionDoc, FixtureDoc } from "../../shared/types";

export function useAdminFixtures(sportIds: readonly string[]): { fixtures: FixtureDoc[]; loading: boolean; error: boolean; retry: () => void } {
  const key = [...sportIds].sort().join("|");
  const [fixtures, setFixtures] = useState<FixtureDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ids = key ? key.split("|") : [];
    setError(false);
    if (ids.length === 0) {
      setFixtures([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
    const parts = new Map<number, FixtureDoc[]>();
    const publish = () => {
      if (parts.size < chunks.length) return;
      setFixtures([...parts.values()].flat());
      setLoading(false);
    };
    const unsubs = chunks.map((chunk, index) =>
      onSnapshot(
        query(collection(db, "fixtures"), where("sportId", "in", chunk)),
        (snap) => {
          parts.set(index, snap.docs.map((d) => d.data() as FixtureDoc));
          publish();
        },
        () => {
          setError(true);
          setLoading(false);
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [key, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { fixtures, loading, error, retry };
}

export function useAllCompetitions(): CompetitionDoc[] | null {
  const [competitions, setCompetitions] = useState<CompetitionDoc[] | null>(null);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "competitions"),
      (snap) => setCompetitions(snap.docs.map((d) => d.data() as CompetitionDoc)),
      () => setCompetitions([])
    );
    return unsub;
  }, []);
  return competitions;
}

export function useRoundTotalsFrom(fixtures: readonly FixtureDoc[]): ReadonlyMap<string, number> {
  return useMemo(() => {
    const totals = new Map<string, number>();
    for (const f of fixtures) totals.set(f.competitionId, Math.max(totals.get(f.competitionId) ?? 0, f.round));
    return totals;
  }, [fixtures]);
}

export function useAdminsState() {
  return useListener<AdminDoc[]>(
    (next, fail) =>
      onSnapshot(
        collection(db, "admins"),
        (snap) => next(snap.docs.map((d) => d.data() as AdminDoc).sort((a, b) => a.email.localeCompare(b.email))),
        fail
      ),
    []
  );
}

export function useEntityDocsState(kind: "sports" | "competitions" | "teams" | "participants", competitionId: string | null) {
  const needsCompetition = kind === "teams" || kind === "participants";
  return useListener<Record<string, unknown>[]>(
    needsCompetition && !competitionId
      ? null
      : (next, fail) =>
          onSnapshot(
            needsCompetition ? query(collection(db, kind), where("competitionId", "==", competitionId)) : collection(db, kind),
            (snap) => next(snap.docs.map((d) => d.data() as Record<string, unknown>)),
            fail
          ),
    [kind, competitionId]
  );
}
