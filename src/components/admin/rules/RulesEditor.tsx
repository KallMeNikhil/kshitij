import { useMemo, useState, type ReactNode } from "react";
import { Segmented } from "../../Segmented";
import { matchConfigurationSchema, matchStructureKindByScoringModel, type MatchConfiguration, type MatchStructure } from "../../../../shared/matchConfig";
import { describeFormat } from "../../../../shared/scoring/describeFormat";
import type { ParticipantType, ScoringModel } from "../../../../shared/types";

type Mode = "form" | "json";
type Obj = Record<string, unknown>;

const MODES = [
  { value: "form", label: "Form" },
  { value: "json", label: "JSON" },
];

const ROUND_NAMES: Record<number, string> = { 0: "Final", 1: "Semi-finals", 2: "Quarter-finals", 3: "Round of 16" };
const roundName = (n: number) => ROUND_NAMES[n] ?? `${n} rounds before the final`;

function blankStructure(kind: MatchStructure["kind"]): Obj {
  switch (kind) {
    case "SETS_POINTS":
      return { kind, bestOf: 3, pointsToWin: 21 };
    case "GAMES_SETS":
      return { kind, bestOfSets: 3, gamesPerSet: 6, tieBreakAtGames: 6, tieBreakPoints: 7 };
    case "INNINGS":
      return { kind, oversPerInnings: 10, inningsPerSide: 1, wicketsPerInnings: 10 };
    case "PERIODS":
      return { kind, periodLabel: "QUARTER", periodCount: 4, minutesPerPeriod: 10, drawAllowed: false };
    case "EVENTS":
      return { kind, periodCount: 2, minutesPerPeriod: 45, penaltiesOnDraw: true };
    default:
      return { kind: "RESULT_ONLY", drawAllowed: true, pointDetail: "NONE" };
  }
}

export function blankConfiguration(scoringModel: ScoringModel, participantType: ParticipantType = "INDIVIDUAL"): MatchConfiguration {
  return {
    configVersion: 1,
    scoringModel,
    participantModel: participantType === "TEAM" ? { participantType, teamSize: { min: 5, max: 11 } } : { participantType },
    structure: blankStructure(matchStructureKindByScoringModel[scoringModel]) as MatchStructure,
    walkoverBehavior: "OPPONENT_WINS",
    byeBehavior: "AUTO_ADVANCE",
    pending: [],
  };
}

function parse(text: string): Obj | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
  } catch {
    return null;
  }
}

function set(obj: Obj, key: string, value: unknown): Obj {
  const next = { ...obj };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return next;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="admin-field">
      <span className="admin-field__label">{label}</span>
      {children}
      {hint && <span className="admin-hint">{hint}</span>}
    </label>
  );
}

function NumberInput({ value, onChange, optional, min = 1 }: { value: unknown; onChange: (v: number | undefined) => void; optional?: boolean; min?: number }) {
  return (
    <input
      className="admin-input"
      type="number"
      inputMode="numeric"
      min={min}
      value={typeof value === "number" ? value : ""}
      placeholder={optional ? "Not set" : undefined}
      onChange={(e) => {
        const raw = e.target.value.trim();
        onChange(raw === "" ? undefined : Math.floor(Number(raw)));
      }}
    />
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="admin-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Select<T extends string>({ value, options, onChange }: { value: unknown; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <select className="admin-input" value={typeof value === "string" ? value : options[0][0]} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function StructureFields({ structure, onChange }: { structure: Obj; onChange: (next: Obj) => void }) {
  const num = (key: string, label: string, opts: { optional?: boolean; hint?: string; min?: number } = {}) => (
    <Field label={label} hint={opts.hint}>
      <NumberInput value={structure[key]} optional={opts.optional} min={opts.min} onChange={(v) => onChange(set(structure, key, v))} />
    </Field>
  );
  const kind = structure.kind as MatchStructure["kind"];

  if (kind === "SETS_POINTS") {
    const deciding = (structure.decidingSetFormat as Obj | undefined) ?? undefined;
    const perSet = Array.isArray(structure.setPointsBySetIndex) ? (structure.setPointsBySetIndex as number[]).join(", ") : "";
    return (
      <div className="fixture-schedule__fields">
        {num("bestOf", "Best of (sets or games)", { hint: "Use an odd number, for example 3 or 5." })}
        {num("pointsToWin", "Points to win a set")}
        {num("capPoints", "Cap (first to this wins)", { optional: true, hint: "Leave empty to play on until a 2-point lead." })}
        <Field label="Points per set (optional)" hint="Comma separated, for example 25, 25, 15. Overrides the points above for those sets.">
          <input
            className="admin-input"
            value={perSet}
            placeholder="Not set"
            onChange={(e) => {
              const list = e.target.value
                .split(",")
                .map((x) => Math.floor(Number(x.trim())))
                .filter((x) => Number.isFinite(x) && x > 0);
              onChange(set(structure, "setPointsBySetIndex", list.length > 0 ? list : undefined));
            }}
          />
        </Field>
        <Field label="Deciding set points (optional)">
          <NumberInput
            value={deciding?.pointsToWin}
            optional
            onChange={(v) => onChange(set(structure, "decidingSetFormat", v === undefined ? undefined : { ...(deciding ?? {}), pointsToWin: v }))}
          />
        </Field>
        {deciding && (
          <Field label="Deciding set cap (optional)">
            <NumberInput value={deciding.capPoints} optional onChange={(v) => onChange(set(structure, "decidingSetFormat", set(deciding, "capPoints", v)))} />
          </Field>
        )}
      </div>
    );
  }

  if (kind === "GAMES_SETS") {
    return (
      <div className="fixture-schedule__fields">
        {num("bestOfSets", "Best of (sets)", { hint: "Use an odd number." })}
        {num("gamesPerSet", "Games per set")}
        {num("tieBreakAtGames", "Tie-break at games-all", { optional: true, hint: "Leave empty for advantage sets." })}
        {num("tieBreakPoints", "Tie-break points", { optional: true })}
        <Field label="Deciding set">
          <Select
            value={structure.finalSetFormat ?? "FULL_SET"}
            options={[
              ["FULL_SET", "Full set"],
              ["SUPER_TIE_BREAK", "Match tie-break instead of a set"],
            ]}
            onChange={(v) => onChange(set(structure, "finalSetFormat", v))}
          />
        </Field>
        {structure.finalSetFormat === "SUPER_TIE_BREAK" && num("superTieBreakPoints", "Match tie-break points", { optional: true, hint: "Defaults to 10." })}
        <Check checked={structure.noAd === true} onChange={(v) => onChange(set(structure, "noAd", v || undefined))} label="No-ad scoring (deciding point at deuce)" />
      </div>
    );
  }

  if (kind === "INNINGS") {
    return (
      <div className="fixture-schedule__fields">
        {num("oversPerInnings", "Overs per innings")}
        {num("wicketsPerInnings", "Wickets per innings", { optional: true, hint: "Defaults to 10." })}
        {num("inningsPerSide", "Innings per side")}
      </div>
    );
  }

  if (kind === "PERIODS") {
    return (
      <div className="fixture-schedule__fields">
        <Field label="Period type">
          <Select
            value={structure.periodLabel}
            options={[
              ["QUARTER", "Quarters"],
              ["HALF", "Halves"],
              ["PERIOD", "Periods"],
            ]}
            onChange={(v) => onChange(set(structure, "periodLabel", v))}
          />
        </Field>
        {num("periodCount", "Number of periods")}
        {num("minutesPerPeriod", "Minutes per period", { optional: true })}
      </div>
    );
  }

  if (kind === "EVENTS") {
    return (
      <div className="fixture-schedule__fields">
        {num("periodCount", "Number of halves")}
        {num("minutesPerPeriod", "Minutes per half", { optional: true })}
        <Check checked={structure.penaltiesOnDraw !== false} onChange={(v) => onChange(set(structure, "penaltiesOnDraw", v))} label="Penalty shoot-out when level" />
      </div>
    );
  }

  const boards = structure.pointDetail === "SCORE_BREAKDOWN";
  return (
    <div className="fixture-schedule__fields">
      <Field label="Scoring">
        <Select
          value={structure.pointDetail}
          options={[
            ["NONE", "Single result (win, loss or draw)"],
            ["SCORE_BREAKDOWN", "Boards with points"],
          ]}
          onChange={(v) => onChange(set(structure, "pointDetail", v))}
        />
      </Field>
      {boards && num("bestOfBoards", "Best of (boards)", { optional: true, hint: "Use an odd number. Defaults to 3." })}
      {!boards && <Check checked={structure.drawAllowed !== false} onChange={(v) => onChange(set(structure, "drawAllowed", v))} label="A game can be drawn" />}
      {!boards && structure.drawAllowed !== false && (
        <Field label="Tie-break after a draw" hint="Shown to the scorer, for example Rapid tie-break game.">
          <input className="admin-input" value={typeof structure.tieBreak === "string" ? structure.tieBreak : ""} maxLength={60} onChange={(e) => onChange(set(structure, "tieBreak", e.target.value))} />
        </Field>
      )}
    </div>
  );
}

function RulesForm({ config, onChange }: { config: Obj; onChange: (next: Obj) => void }) {
  const structure = (config.structure as Obj) ?? {};
  const participant = (config.participantModel as Obj) ?? {};
  const teamSize = participant.teamSize as Obj | undefined;
  const overrides = Array.isArray(config.roundOverrides) ? (config.roundOverrides as Obj[]) : [];
  const pending = Array.isArray(config.pending) ? (config.pending as string[]) : [];
  const updateOverride = (index: number, next: Obj | null) => {
    const list = overrides.map((o, i) => (i === index ? next : o)).filter((o): o is Obj => o !== null);
    onChange(set(config, "roundOverrides", list.length > 0 ? list : undefined));
  };
  const freeRound = [0, 1, 2, 3, 4, 5, 6, 7].find((n) => !overrides.some((o) => o.roundsFromEnd === n));

  return (
    <div className="rules-form">
      <p className="admin-hint">Scoring model: {String(config.scoringModel ?? "not set")}</p>
      <h3 className="admin-card__title">Match format</h3>
      <StructureFields structure={structure} onChange={(next) => onChange({ ...config, structure: next })} />

      <h3 className="admin-card__title">Different format for later rounds</h3>
      {overrides.length === 0 && <p className="admin-hint">Every round uses the format above.</p>}
      {overrides.map((o, i) => (
        <div key={i} className="admin-card">
          <div className="control__row">
            <Field label="Round">
              <select
                className="admin-input"
                value={String(o.roundsFromEnd)}
                onChange={(e) => updateOverride(i, { ...o, roundsFromEnd: Number(e.target.value) })}
              >
                {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n} disabled={n !== o.roundsFromEnd && overrides.some((x) => x.roundsFromEnd === n)}>
                    {roundName(n)}
                  </option>
                ))}
              </select>
            </Field>
            <button type="button" className="admin-btn admin-btn--small" onClick={() => updateOverride(i, null)}>
              Remove
            </button>
          </div>
          <StructureFields structure={(o.structure as Obj) ?? {}} onChange={(next) => updateOverride(i, { ...o, structure: next })} />
        </div>
      ))}
      {freeRound !== undefined && (
        <button
          type="button"
          className="admin-btn admin-btn--small"
          onClick={() => onChange({ ...config, roundOverrides: [...overrides, { roundsFromEnd: freeRound, structure: { ...structure } }] })}
        >
          Add a round format
        </button>
      )}

      <h3 className="admin-card__title">Entrants</h3>
      <div className="fixture-schedule__fields">
        <Field label="Entrant type">
          <Select
            value={participant.participantType}
            options={[
              ["INDIVIDUAL", "Individual"],
              ["PAIR", "Pair"],
              ["TEAM", "Team"],
            ]}
            onChange={(v) => onChange({ ...config, participantModel: v === "TEAM" ? { ...participant, participantType: v, teamSize: teamSize ?? { min: 5, max: 11 } } : { participantType: v } })}
          />
        </Field>
        {participant.participantType === "TEAM" && (
          <>
            <Field label="Minimum players">
              <NumberInput value={teamSize?.min} onChange={(v) => onChange({ ...config, participantModel: { ...participant, teamSize: { ...(teamSize ?? {}), min: v } } })} />
            </Field>
            <Field label="Maximum players on court or field">
              <NumberInput value={teamSize?.max} onChange={(v) => onChange({ ...config, participantModel: { ...participant, teamSize: { ...(teamSize ?? {}), max: v } } })} />
            </Field>
            <Field label="Substitutes allowed">
              <NumberInput value={participant.substitutesAllowed} optional min={0} onChange={(v) => onChange({ ...config, participantModel: set(participant, "substitutesAllowed", v) })} />
            </Field>
          </>
        )}
      </div>

      <h3 className="admin-card__title">Other</h3>
      <div className="fixture-schedule__fields">
        <Field label="Walkover">
          <Select
            value={config.walkoverBehavior}
            options={[
              ["OPPONENT_WINS", "Opponent advances"],
              ["BOTH_ELIMINATED", "Both eliminated (not supported for knockouts)"],
            ]}
            onChange={(v) => onChange(set(config, "walkoverBehavior", v))}
          />
        </Field>
        <Field label="Rules still to confirm" hint="One per line. Shown as a warning on the scoring screen.">
          <textarea
            className="admin-input"
            rows={3}
            value={pending.join("\n")}
            onChange={(e) => onChange({ ...config, pending: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
          />
        </Field>
        <Field label="Notes">
          <textarea className="admin-input" rows={2} maxLength={500} value={typeof config.notes === "string" ? config.notes : ""} onChange={(e) => onChange(set(config, "notes", e.target.value))} />
        </Field>
      </div>
    </div>
  );
}

export function RulesEditor({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [mode, setMode] = useState<Mode>("form");
  const config = useMemo(() => parse(text), [text]);
  const check = useMemo(() => (config ? matchConfigurationSchema.safeParse(config) : null), [config]);
  const summary = check?.success ? describeFormat(check.data) : null;
  const update = (next: Obj) => onChange(JSON.stringify(next, null, 2));

  return (
    <div className="rules-editor">
      <Segmented aria-label="Editor" skin="pill" options={MODES} value={mode} onChange={(v) => setMode(v as Mode)} />
      {mode === "form" ? (
        config ? (
          <RulesForm config={config} onChange={update} />
        ) : (
          <p className="admin-alert admin-alert--warning" role="alert">
            The JSON is not valid, so the form can't show it. Fix it in the JSON tab.
          </p>
        )
      ) : (
        <label className="admin-field">
          <span className="admin-field__label">matchConfiguration (JSON)</span>
          <textarea className="admin-input admin-input--code" rows={14} value={text} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
        </label>
      )}
      {summary && <p className="admin-hint">Summary: {summary}</p>}
      {check && !check.success && (
        <p className="admin-alert admin-alert--warning" role="alert">
          {check.error.issues.map((i) => `${i.path.join(".") || "rules"}: ${i.message}`).join("; ")}
        </p>
      )}
    </div>
  );
}
