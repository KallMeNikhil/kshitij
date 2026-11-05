import type { ReactNode } from "react";

type Obj = Record<string, unknown>;

const READ_ONLY: Record<string, string> = {
  status: "Changed with Withdraw",
  published: "Changed with Publish on the Brackets page",
  importBatchId: "Set by the import",
};

const humanize = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Id\b/g, "ID")
    .replace(/^./, (c) => c.toUpperCase());

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="admin-field">
      <span className="admin-field__label">{label}</span>
      {children}
      {hint && <span className="admin-hint">{hint}</span>}
    </label>
  );
}

export function RecordForm({ record, idField, onChange }: { record: Obj; idField: string; onChange: (next: Obj) => void }) {
  const set = (key: string, value: unknown) => onChange({ ...record, [key]: value });
  const nested: string[] = [];

  const fields = Object.entries(record).map(([key, value]) => {
    const label = humanize(key);
    if (key === idField) {
      return (
        <Row key={key} label={label} hint="The ID cannot be changed">
          <input className="admin-input" value={String(value)} disabled />
        </Row>
      );
    }
    if (READ_ONLY[key] !== undefined) {
      return (
        <Row key={key} label={label} hint={READ_ONLY[key]}>
          <input className="admin-input" value={String(value)} disabled />
        </Row>
      );
    }
    if (typeof value === "boolean") {
      return (
        <label key={key} className="admin-check">
          <input type="checkbox" checked={value} onChange={(e) => set(key, e.target.checked)} />
          <span>{label}</span>
        </label>
      );
    }
    if (typeof value === "number") {
      return (
        <Row key={key} label={label}>
          <input className="admin-input" type="number" value={value} onChange={(e) => set(key, e.target.value === "" ? 0 : Number(e.target.value))} />
        </Row>
      );
    }
    if (typeof value === "string") {
      return (
        <Row key={key} label={label}>
          <input className="admin-input" value={value} onChange={(e) => set(key, e.target.value)} />
        </Row>
      );
    }
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      return (
        <Row key={key} label={label} hint="Comma separated">
          <input
            className="admin-input"
            value={(value as string[]).join(", ")}
            onChange={(e) => set(key, e.target.value.split(",").map((v) => v.trim()).filter(Boolean))}
          />
        </Row>
      );
    }
    nested.push(label);
    return null;
  });

  return (
    <div className="record-form">
      {fields}
      {nested.length > 0 && <p className="admin-hint">Edit {nested.join(", ")} in the JSON tab.</p>}
    </div>
  );
}
