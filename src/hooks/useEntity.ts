import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import type { ParticipantDoc, Slot, TeamDoc } from "../../shared/types";

const ENTITY_CACHE_TTL_MS = 60_000;
type Cached<T> = { data: T; at: number };
const participantCache = new Map<string, Cached<ParticipantDoc>>();
const teamCache = new Map<string, Cached<TeamDoc>>();

const fresh = <T,>(entry: Cached<T> | undefined): entry is Cached<T> =>
  !!entry && Date.now() - entry.at < ENTITY_CACHE_TTL_MS;

async function fetchParticipant(id: string): Promise<ParticipantDoc | null> {
  const hit = participantCache.get(id);
  if (fresh(hit)) return hit.data;
  const snap = await getDoc(doc(db, "participants", id));
  if (!snap.exists()) return null;
  const data = snap.data() as ParticipantDoc;
  participantCache.set(id, { data, at: Date.now() });
  return data;
}

async function fetchTeam(id: string): Promise<TeamDoc | null> {
  const hit = teamCache.get(id);
  if (fresh(hit)) return hit.data;
  const snap = await getDoc(doc(db, "teams", id));
  if (!snap.exists()) return null;
  const data = snap.data() as TeamDoc;
  teamCache.set(id, { data, at: Date.now() });
  return data;
}

export interface ResolvedSlot {
  label: string;
  kind: Slot["kind"];
  participant?: ParticipantDoc;
  team?: TeamDoc;

  withdrawn?: boolean;
}

export function useResolvedSlot(slot: Slot | undefined): ResolvedSlot | null {
  const [resolved, setResolved] = useState<ResolvedSlot | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!slot) {
      setResolved(null);
      return;
    }
    if (slot.kind === "BYE") {
      setResolved({ label: "BYE", kind: "BYE" });
      return;
    }
    if (slot.kind === "FIXTURE_WINNER") {
      setResolved({ label: "TBD", kind: "FIXTURE_WINNER" });
      return;
    }
    if (slot.kind === "TBD") {
      setResolved({ label: "TBD", kind: "TBD" });
      return;
    }
    setResolved(null);
    const failed = () => {
      if (!cancelled) setResolved(null);
    };
    if (slot.kind === "PARTICIPANT" && slot.participantId) {
      fetchParticipant(slot.participantId)
        .then((p) => {
          if (!cancelled) setResolved(p ? { label: p.name, kind: "PARTICIPANT", participant: p, withdrawn: p.status === "WITHDRAWN" } : null);
        })
        .catch(failed);
    }
    if (slot.kind === "TEAM" && slot.teamId) {
      fetchTeam(slot.teamId)
        .then((t) => {
          if (!cancelled) setResolved(t ? { label: t.teamName ?? t.college, kind: "TEAM", team: t, withdrawn: t.status === "WITHDRAWN" } : null);
        })
        .catch(failed);
    }
    return () => {
      cancelled = true;
    };
  }, [slot?.kind, slot?.participantId, slot?.teamId]);

  return resolved;
}

export function useTeamRoster(teamId: string | undefined): ParticipantDoc[] {
  const [roster, setRoster] = useState<ParticipantDoc[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!teamId) {
      setRoster([]);
      return;
    }
    fetchTeam(teamId)
      .then(async (team) => {
        if (!team) return;
        const members = await Promise.all(team.memberIds.map((id) => fetchParticipant(id)));
        if (!cancelled) setRoster(members.filter((m): m is ParticipantDoc => !!m));
      })
      .catch(() => {
        if (!cancelled) setRoster([]);
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);
  return roster;
}
