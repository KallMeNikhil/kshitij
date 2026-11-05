import { useMemo } from "react";
import { useAuth } from "./AuthContext";
import { useSportsState } from "../hooks/useFirestoreData";
import type { SportDoc } from "../../shared/types";

export function useAdminScope() {
  const { admin } = useAuth();
  const sportsState = useSportsState(true);
  const sports = sportsState.data;
  const isSuper = admin?.role === "SUPER_ADMIN";
  const scopedSports = useMemo<SportDoc[]>(() => {
    if (!sports) return [];
    return isSuper ? sports : sports.filter((s) => admin?.sportIds.includes(s.sportId));
  }, [sports, isSuper, admin]);
  const sportIds = useMemo(() => scopedSports.map((s) => s.sportId), [scopedSports]);
  const canAccessSport = (sportId: string) => isSuper || (admin?.sportIds.includes(sportId) ?? false);
  return {
    admin,
    isSuper,
    sports,
    scopedSports,
    sportIds,
    canAccessSport,
    sportsLoading: sportsState.loading,
    sportsError: sportsState.error,
    retrySports: sportsState.retry,
  };
}
