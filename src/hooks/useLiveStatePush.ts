import { useCallback, useState } from "react";
import { updateLiveState } from "../lib/callables";
import { ApiError } from "../lib/apiClient";
import { describeError } from "../lib/describeError";

export function useLiveStatePush(fixtureId: string, version: number) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const push = useCallback(
    async (data: object): Promise<boolean> => {
      setPending(true);
      setError("");
      try {
        await updateLiveState({ fixtureId, expectedVersion: version, data: data as Record<string, unknown> });
        return true;
      } catch (err) {
        setError(
          err instanceof ApiError && err.code === "VERSION_CONFLICT"
            ? "This score was updated somewhere else. The latest score is now shown, so check it and try again."
            : `Score was not saved. ${describeError(err)}`
        );
        return false;
      } finally {
        setPending(false);
      }
    },
    [fixtureId, version]
  );

  return { pending, error, push };
}
