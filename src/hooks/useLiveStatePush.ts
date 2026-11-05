import { useCallback, useState } from "react";
import { undoLiveState, updateLiveState } from "../lib/callables";
import { ApiError } from "../lib/apiClient";
import { describeError } from "../lib/describeError";

export function useLiveStatePush(fixtureId: string, version: number, canUndo = false) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async (action: () => Promise<unknown>, failure: string): Promise<boolean> => {
    setPending(true);
    setError("");
    try {
      await action();
      return true;
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "VERSION_CONFLICT"
          ? "This score was updated somewhere else. The latest score is now shown, so check it and try again."
          : `${failure} ${describeError(err)}`
      );
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  const push = useCallback(
    (data: object) => run(() => updateLiveState({ fixtureId, expectedVersion: version, data: data as Record<string, unknown> }), "Score was not saved."),
    [fixtureId, version, run]
  );

  const undo = useCallback(() => run(() => undoLiveState({ fixtureId, expectedVersion: version }), "Could not undo."), [fixtureId, version, run]);

  return { pending, error, push, undo, canUndo };
}
