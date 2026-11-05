import { useSearchParams } from "react-router-dom";
import { Segmented } from "../../components/Segmented";
import { ManageAccess } from "./manage/ManageAccess";
import { ManageEntities } from "./manage/ManageEntities";
import { ManageRules } from "./manage/ManageRules";
import { ManageAnnouncements } from "./manage/ManageAnnouncements";
import { ManageAudit } from "./manage/ManageAudit";
import { ManageCleanup } from "./manage/ManageCleanup";
import { ManageGallery } from "./manage/ManageGallery";
import { ManageCommittee } from "./manage/ManageCommittee";
import { ManageSiteDetails } from "./manage/ManageSiteDetails";

const SECTIONS = [
  { value: "access", label: "People" },
  { value: "data", label: "Event data" },
  { value: "cleanup", label: "Cleanup" },
  { value: "rules", label: "Rules" },
  { value: "announcements", label: "Announcements" },
  { value: "gallery", label: "Gallery" },
  { value: "committee", label: "Committee" },
  { value: "details", label: "Site details" },
  { value: "audit", label: "Audit" },
];

export function ManagePage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("s");
  const section = SECTIONS.some((s) => s.value === requested) ? (requested as string) : "access";

  return (
    <div className="admin-page">
      <h1 className="admin-page__title">Manage</h1>
      <Segmented
        aria-label="Manage section"
        skin="underline"
        className="admin-section-tabs"
        options={SECTIONS}
        value={section}
        onChange={(v) => setParams({ s: v }, { replace: true })}
      />
      {section === "access" && <ManageAccess />}
      {section === "data" && <ManageEntities />}
      {section === "cleanup" && <ManageCleanup />}
      {section === "rules" && <ManageRules />}
      {section === "announcements" && <ManageAnnouncements />}
      {section === "gallery" && <ManageGallery />}
      {section === "committee" && <ManageCommittee />}
      {section === "details" && <ManageSiteDetails />}
      {section === "audit" && <ManageAudit />}
    </div>
  );
}
