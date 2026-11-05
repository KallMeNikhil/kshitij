import { useCallback, useMemo, useState } from "react";

export type MoveDirection = "up" | "down" | "top" | "bottom";

export function useOrderDraft<T extends { id: string }>(items: readonly T[] | null) {
  const [draft, setDraft] = useState<string[] | null>(null);

  const serverIds = useMemo(() => (items ?? []).map((item) => item.id), [items]);

  const ids = useMemo(() => {
    if (!draft) return serverIds;
    const known = new Set(serverIds);
    const kept = draft.filter((id) => known.has(id));
    const keptSet = new Set(kept);
    return [...kept, ...serverIds.filter((id) => !keptSet.has(id))];
  }, [draft, serverIds]);

  const ordered = useMemo(() => {
    const byId = new Map((items ?? []).map((item) => [item.id, item]));
    return ids.map((id) => byId.get(id)).filter((item): item is T => item !== undefined);
  }, [ids, items]);

  const dirty = useMemo(() => ids.some((id, index) => id !== serverIds[index]), [ids, serverIds]);

  const moveTo = useCallback(
    (id: string, index: number) => {
      const from = ids.indexOf(id);
      if (from < 0) return;
      const target = Math.max(0, Math.min(ids.length - 1, index));
      if (target === from) return;
      const next = ids.filter((existing) => existing !== id);
      next.splice(target, 0, id);
      setDraft(next);
    },
    [ids]
  );

  const move = useCallback(
    (id: string, direction: MoveDirection) => {
      const from = ids.indexOf(id);
      if (from < 0) return;
      if (direction === "up") moveTo(id, from - 1);
      else if (direction === "down") moveTo(id, from + 1);
      else if (direction === "top") moveTo(id, 0);
      else moveTo(id, ids.length - 1);
    },
    [ids, moveTo]
  );

  const reset = useCallback(() => setDraft(null), []);

  return { ordered, ids, dirty, move, moveTo, reset };
}
