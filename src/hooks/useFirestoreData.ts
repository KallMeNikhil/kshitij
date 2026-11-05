import { useCallback, useEffect, useState } from "react";
import { collection, doc, documentId, limit as fsLimit, onSnapshot, orderBy, query, where, type Unsubscribe } from "firebase/firestore";
import { db } from "../lib/firebase";
import { parseCommittee, parseGallery } from "../lib/siteContent";
import type {
  AnnouncementDoc,
  CommitteeMemberDoc,
  GalleryItemDoc,
  SiteDetailsDoc,
  AuditLogDoc,
  CompetitionDoc,
  EntrantStatus,
  FixtureDoc,
  MatchStateDoc,
  ParticipantDoc,
  SportDoc,
  TeamDoc,
} from "../../shared/types";

export interface Listened<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

type Subscribe<T> = (next: (value: T) => void, fail: () => void) => Unsubscribe;

export function useListener<T>(subscribe: Subscribe<T> | null, deps: readonly unknown[]): Listened<T> {
  const [state, setState] = useState<{ data: T | null; error: boolean; ready: boolean }>({ data: null, error: false, ready: false });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setState({ data: null, error: false, ready: false });
    if (!subscribe) return;
    return subscribe(
      (data) => setState({ data, error: false, ready: true }),
      () => setState({ data: null, error: true, ready: true })
    );
  }, [...deps, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, loading: subscribe !== null && !state.ready, error: state.error, retry };
}

export interface SiteContentDocs {
  gallery: GalleryItemDoc[];
  committee: CommitteeMemberDoc[];
  details: SiteDetailsDoc | null;
}

export function useSiteContentState() {
  return useListener<SiteContentDocs>(
    (next, fail) => {
      const parts: { gallery?: GalleryItemDoc[]; committee?: CommitteeMemberDoc[]; details?: SiteDetailsDoc | null } = {};
      let failed = false;
      const emit = () => {
        if (failed || parts.gallery === undefined || parts.committee === undefined || parts.details === undefined) return;
        next({ gallery: parts.gallery, committee: parts.committee, details: parts.details });
      };
      const onFail = () => {
        failed = true;
        fail();
      };
      const unsubs = [
        onSnapshot(
          doc(db, "siteContent", "gallery"),
          (snap) => {
            parts.gallery = snap.exists() ? parseGallery(snap.data().items) : [];
            emit();
          },
          onFail
        ),
        onSnapshot(
          doc(db, "siteContent", "committee"),
          (snap) => {
            parts.committee = snap.exists() ? parseCommittee(snap.data().members) : [];
            emit();
          },
          onFail
        ),
        onSnapshot(
          doc(db, "siteContent", "details"),
          (snap) => {
            parts.details = snap.exists() ? (snap.data() as SiteDetailsDoc) : null;
            emit();
          },
          onFail
        ),
      ];
      return () => unsubs.forEach((u) => u());
    },
    []
  );
}

const settle = <T,>(state: Listened<T>, onError: T | null): T | null => (state.error ? onError : state.data);

export function useSportsState() {
  return useListener<SportDoc[]>(
    (next, fail) =>
      onSnapshot(
        collection(db, "sports"),
        (snap) =>
          next(
            snap.docs
              .map((d) => d.data() as SportDoc)
              .filter((s) => s.active !== false)
              .sort((a, b) => a.displayOrder - b.displayOrder)
          ),
        fail
      ),
    []
  );
}

export const useSports = () => settle(useSportsState(), []);

export function useAuditLogsState(max = 50) {
  return useListener<(AuditLogDoc & { id: string })[]>(
    (next, fail) =>
      onSnapshot(
        query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), fsLimit(max)),
        (snap) => next(snap.docs.map((d) => ({ id: d.id, ...(d.data() as AuditLogDoc) }))),
        fail
      ),
    [max]
  );
}

export function useAnnouncementsState(max = 8) {
  return useListener<AnnouncementDoc[]>(
    (next, fail) =>
      onSnapshot(
        query(collection(db, "announcements"), orderBy("createdAt", "desc"), fsLimit(max)),
        (snap) => next(snap.docs.map((d) => ({ announcementId: d.id, ...d.data() } as AnnouncementDoc))),
        fail
      ),
    [max]
  );
}

export const useAnnouncements = (max = 8) => settle(useAnnouncementsState(max), []);

export function useRecentCompletedState(max = 6) {
  return useListener<FixtureDoc[]>(
    (next, fail) =>
      onSnapshot(
        query(collection(db, "fixtures"), where("status", "==", "COMPLETED")),
        (snap) => {
          const played = snap.docs
            .map((d) => d.data() as FixtureDoc)
            .filter((f) => f.slotA.kind !== "BYE" && f.slotB.kind !== "BYE")
            .sort(
              (a, b) =>
                `${b.scheduledDate ?? ""}T${b.scheduledTime ?? ""}`.localeCompare(`${a.scheduledDate ?? ""}T${a.scheduledTime ?? ""}`) ||
                b.round - a.round ||
                b.matchNumber - a.matchNumber
            );
          next(played.slice(0, max));
        },
        fail
      ),
    [max]
  );
}

export const useRecentCompleted = (max = 6) => settle(useRecentCompletedState(max), []);

export function useCompetitionsState(sportId: string | null, includeUnpublished = false) {
  return useListener<CompetitionDoc[]>(
    sportId
      ? (next, fail) => {
          const constraints = [where("sportId", "==", sportId)];
          if (!includeUnpublished) constraints.push(where("published", "==", true));
          return onSnapshot(
            query(collection(db, "competitions"), ...constraints),
            (snap) => next(snap.docs.map((d) => d.data() as CompetitionDoc).sort((a, b) => a.displayOrder - b.displayOrder)),
            fail
          );
        }
      : null,
    [sportId, includeUnpublished]
  );
}

export const useCompetitions = (sportId: string | null, includeUnpublished = false) =>
  settle(useCompetitionsState(sportId, includeUnpublished), []);

export function useFixturesState(competitionId: string | null, includeDrafts = false) {
  return useListener<FixtureDoc[]>(
    competitionId
      ? (next, fail) => {
          const constraints = [where("competitionId", "==", competitionId)];
          if (!includeDrafts) constraints.push(where("status", "!=", "DRAFT"));
          return onSnapshot(
            query(collection(db, "fixtures"), ...constraints),
            (snap) => next(snap.docs.map((d) => d.data() as FixtureDoc).sort((a, b) => a.round - b.round || a.matchNumber - b.matchNumber)),
            fail
          );
        }
      : null,
    [competitionId, includeDrafts]
  );
}

export const useFixtures = (competitionId: string | null, includeDrafts = false) =>
  settle(useFixturesState(competitionId, includeDrafts), []);

export interface Entrant {
  id: string;
  label: string;
  status: EntrantStatus;
}

export function useEntrantsState(competitionId: string | null, participantType: "INDIVIDUAL" | "PAIR" | "TEAM" | null) {
  const isTeamLike = participantType === "TEAM" || participantType === "PAIR";
  return useListener<Entrant[]>(
    competitionId && participantType
      ? (next, fail) =>
          onSnapshot(
            query(collection(db, isTeamLike ? "teams" : "participants"), where("competitionId", "==", competitionId)),
            (snap) =>
              next(
                isTeamLike
                  ? snap.docs.map((d) => {
                      const t = d.data() as TeamDoc;
                      return { id: t.teamId, label: t.teamName ?? t.college, status: t.status ?? "ACTIVE" };
                    })
                  : snap.docs.map((d) => {
                      const p = d.data() as ParticipantDoc;
                      return { id: p.participantId, label: `${p.name} (${p.college})`, status: p.status ?? "ACTIVE" };
                    })
              ),
            fail
          )
      : null,
    [competitionId, participantType]
  );
}

export function useFixtureState(fixtureId: string | null) {
  return useListener<FixtureDoc | "MISSING">(
    fixtureId
      ? (next, fail) =>
          onSnapshot(doc(db, "fixtures", fixtureId), (snap) => next(snap.exists() ? (snap.data() as FixtureDoc) : "MISSING"), fail)
      : null,
    [fixtureId]
  );
}

export function useFixture(fixtureId: string | null) {
  const { data } = useFixtureState(fixtureId);
  return data === "MISSING" ? null : data;
}

export function useLiveFixturesState() {
  return useListener<FixtureDoc[]>(
    (next, fail) =>
      onSnapshot(query(collection(db, "fixtures"), where("status", "==", "LIVE")), (snap) => next(snap.docs.map((d) => d.data() as FixtureDoc)), fail),
    []
  );
}

export const useLiveFixtures = () => settle(useLiveFixturesState(), []);

export function useUpcomingFixturesState(max = Infinity) {
  return useListener<FixtureDoc[]>(
    (next, fail) =>
      onSnapshot(
        query(collection(db, "fixtures"), where("status", "==", "SCHEDULED")),
        (snap) => {
          const rows = snap.docs
            .map((d) => d.data() as FixtureDoc)
            .filter((f) => f.scheduledDate)
            .sort((a, b) => `${a.scheduledDate}T${a.scheduledTime ?? ""}`.localeCompare(`${b.scheduledDate}T${b.scheduledTime ?? ""}`));
          next(rows.slice(0, max));
        },
        fail
      ),
    [max]
  );
}

export const useUpcomingFixtures = (max = Infinity) => settle(useUpcomingFixturesState(max), []);

export function useSportUpcomingState(sportId: string | null) {
  return useListener<FixtureDoc[]>(
    sportId
      ? (next, fail) =>
          onSnapshot(
            query(collection(db, "fixtures"), where("sportId", "==", sportId), where("status", "==", "SCHEDULED")),
            (snap) =>
              next(
                snap.docs
                  .map((d) => d.data() as FixtureDoc)
                  .filter((f) => f.scheduledDate)
                  .sort((a, b) => `${a.scheduledDate}T${a.scheduledTime ?? ""}`.localeCompare(`${b.scheduledDate}T${b.scheduledTime ?? ""}`))
              ),
            fail
          )
      : null,
    [sportId]
  );
}

export function useMatchStateState(fixtureId: string | null) {
  return useListener<MatchStateDoc | "MISSING">(
    fixtureId
      ? (next, fail) =>
          onSnapshot(doc(db, "matchStates", fixtureId), (snap) => next(snap.exists() ? (snap.data() as MatchStateDoc) : "MISSING"), fail)
      : null,
    [fixtureId]
  );
}

export function useMatchState(fixtureId: string | null) {
  const { data } = useMatchStateState(fixtureId);
  return data === "MISSING" ? null : data;
}

export function useCompetition(competitionId: string | null) {
  const state = useListener<CompetitionDoc | "MISSING">(
    competitionId
      ? (next, fail) =>
          onSnapshot(doc(db, "competitions", competitionId), (snap) => next(snap.exists() ? (snap.data() as CompetitionDoc) : "MISSING"), fail)
      : null,
    [competitionId]
  );
  return state.data === "MISSING" ? null : state.data;
}

export type MatchStateMap = ReadonlyMap<string, MatchStateDoc>;

export function useMatchStates(fixtureIds: readonly string[]): MatchStateMap | null {
  const key = fixtureIds.join("|");
  const [states, setStates] = useState<MatchStateMap | null>(null);
  useEffect(() => {
    if (fixtureIds.length === 0) {
      setStates(new Map());
      return;
    }
    setStates(null);
    const chunks: string[][] = [];
    for (let i = 0; i < fixtureIds.length; i += 30) chunks.push(fixtureIds.slice(i, i + 30));
    const parts = new Map<number, Map<string, MatchStateDoc>>();
    const publish = () => {
      if (parts.size < chunks.length) return;
      const merged = new Map<string, MatchStateDoc>();
      parts.forEach((m) => m.forEach((v, k) => merged.set(k, v)));
      setStates(merged);
    };
    const unsubs = chunks.map((ids, index) =>
      onSnapshot(
        query(collection(db, "matchStates"), where(documentId(), "in", ids)),
        (snap) => {
          parts.set(index, new Map(snap.docs.map((d) => [d.id, d.data() as MatchStateDoc])));
          publish();
        },
        () => {
          parts.set(index, new Map());
          publish();
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);
  return states;
}

export function usePublishedCompetitionsState() {
  return useListener<CompetitionDoc[]>(
    (next, fail) =>
      onSnapshot(query(collection(db, "competitions"), where("published", "==", true)), (snap) => next(snap.docs.map((d) => d.data() as CompetitionDoc)), fail),
    []
  );
}

export const usePublishedCompetitions = () => settle(usePublishedCompetitionsState(), []);

export function useRoundTotals(competitionIds: readonly string[]): ReadonlyMap<string, number> {
  const key = [...new Set(competitionIds)].sort().join("|");
  const [totals, setTotals] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    const ids = key ? key.split("|") : [];
    setTotals(new Map());
    const unsubs = ids.map((id) =>
      onSnapshot(
        query(collection(db, "fixtures"), where("competitionId", "==", id), where("status", "!=", "DRAFT")),
        (snap) => {
          const rounds = snap.docs.map((d) => (d.data() as FixtureDoc).round);
          setTotals((prev) => new Map(prev).set(id, rounds.length ? Math.max(...rounds) : 0));
        },
        () => undefined
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);
  return totals;
}
