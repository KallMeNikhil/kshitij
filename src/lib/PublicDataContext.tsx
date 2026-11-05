import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useLiveFixturesState, useMatchStates, useSiteContentState, useSportsState, type MatchStateMap, type SiteContentDocs } from "../hooks/useFirestoreData";
import { resolveDetails, toCommitteeMembers, toGalleryImages, type SiteDetails } from "./siteContent";
import type { CommitteeMember, GalleryImage } from "../config/siteContent";
import type { FixtureDoc, SportDoc } from "../../shared/types";

interface PublicData {
  sports: SportDoc[] | null;
  sportsError: boolean;
  liveFixtures: FixtureDoc[] | null;
  liveError: boolean;
  liveStates: MatchStateMap | null;
  retry: () => void;
  siteDocs: SiteContentDocs | null;
  homeSections: ReadonlySet<string>;
  setHomeSections: (ids: ReadonlySet<string>) => void;
}

const PublicDataContext = createContext<PublicData | null>(null);

export function PublicDataProvider({ children }: { children: ReactNode }) {
  const sportsState = useSportsState();
  const liveState = useLiveFixturesState();
  const liveIds = useMemo(() => (liveState.data ?? []).map((f) => f.fixtureId).sort(), [liveState.data]);
  const liveStates = useMatchStates(liveIds);
  const siteState = useSiteContentState();
  const [homeSections, setHomeSections] = useState<ReadonlySet<string>>(new Set());
  const retrySports = sportsState.retry;
  const retryLive = liveState.retry;
  const retry = useCallback(() => {
    retrySports();
    retryLive();
  }, [retrySports, retryLive]);

  const value = useMemo(
    () => ({
      sports: sportsState.data,
      sportsError: sportsState.error,
      liveFixtures: liveState.error ? [] : liveState.data,
      liveError: liveState.error,
      liveStates,
      retry,
      siteDocs: siteState.data,
      homeSections,
      setHomeSections,
    }),
    [sportsState.data, sportsState.error, liveState.data, liveState.error, liveStates, retry, siteState.data, homeSections]
  );
  return <PublicDataContext.Provider value={value}>{children}</PublicDataContext.Provider>;
}

function usePublicData(): PublicData {
  const ctx = useContext(PublicDataContext);
  if (!ctx) throw new Error("PublicDataProvider missing");
  return ctx;
}

export const usePublicSports = () => usePublicData().sports;
export const usePublicSportsStatus = () => {
  const { sportsError, retry } = usePublicData();
  return { error: sportsError, retry };
};
export const usePublicLive = () => usePublicData().liveFixtures;
export const usePublicLiveStates = () => usePublicData().liveStates;
export const usePublicLiveError = () => usePublicData().liveError;
export const usePublicRetry = () => usePublicData().retry;
export const useHomeSections = () => {
  const { homeSections, setHomeSections } = usePublicData();
  return { homeSections, setHomeSections };
};

export interface PublicSiteContent {
  gallery: GalleryImage[] | null;
  committee: CommitteeMember[] | null;
}

export function usePublicSiteContent(): PublicSiteContent {
  const { siteDocs } = usePublicData();
  return useMemo(
    () => ({
      gallery: siteDocs ? toGalleryImages(siteDocs.gallery) : null,
      committee: siteDocs ? toCommitteeMembers(siteDocs.committee) : null,
    }),
    [siteDocs]
  );
}

export function usePublicDetails(): SiteDetails {
  const { siteDocs } = usePublicData();
  return useMemo(() => resolveDetails(siteDocs?.details ?? null), [siteDocs]);
}
