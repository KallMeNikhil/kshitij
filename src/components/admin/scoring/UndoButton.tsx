import type { MatchStateDoc } from "../../../../shared/types";

export function UndoButton({ matchState, pending, onUndo }: { matchState: MatchStateDoc | null; pending: boolean; onUndo: () => Promise<boolean> }) {
  const steps = matchState?.history?.length ?? 0;
  return (
    <button type="button" className="admin-btn admin-btn--block" disabled={pending || steps === 0} onClick={() => void onUndo()}>
      Undo last action{steps > 0 ? ` (${steps} saved)` : ""}
    </button>
  );
}
