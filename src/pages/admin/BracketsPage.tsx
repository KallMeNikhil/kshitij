import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { useCompetitionsState, useEntrantsState, useFixturesState, useSportsState } from "../../hooks/useFirestoreData";
import { generateBracket, publishBracket, upsertEntity, withdrawEntrant } from "../../lib/callables";
import { describeError } from "../../lib/describeError";
import { BracketView } from "../../components/BracketView";
import { ConfirmSheet } from "../../components/admin/ConfirmSheet";
import { ActionStatus, type ActionMessage } from "../../components/admin/ActionStatus";
import { ErrorState, LoadingState } from "../../components/states/StateViews";

type Sheet = "generate" | "publish" | { withdraw: { id: string; label: string } } | null;
type Seeding = "MANUAL" | "RANDOM" | "RANKING";

export function BracketsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const sportsState = useSportsState();
  const sports = sportsState.data;
  const sportId = params.get("sport") ?? "";
  const competitionId = params.get("comp") ?? "";
  const competitionsState = useCompetitionsState(sportId || null, true);
  const competitions = competitionsState.data;
  const competition = (competitions ?? []).find((c) => c.competitionId === competitionId) ?? null;
  const sport = (sports ?? []).find((s) => s.sportId === sportId) ?? null;
  const fixturesState = useFixturesState(competitionId || null, true);
  const fixtures = fixturesState.data;
  const entrantsState = useEntrantsState(competitionId || null, competition?.participantType ?? null);
  const entrants = entrantsState.data;
  const readError = sportsState.error || competitionsState.error || fixturesState.error || entrantsState.error;
  const retryReads = () => {
    sportsState.retry();
    competitionsState.retry();
    fixturesState.retry();
    entrantsState.retry();
  };
  const [seedOrder, setSeedOrder] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const sportSelectId = useId();
  const competitionSelectId = useId();
  const seedingId = useId();

  const seeding: Seeding = competition?.tournamentConfiguration?.seeding ?? "MANUAL";
  const drafts = fixtures?.filter((f) => f.status === "DRAFT").length ?? 0;
  const operational = fixtures?.filter((f) => f.status !== "DRAFT" && !(f.status === "COMPLETED" && (f.slotA.kind === "BYE" || f.slotB.kind === "BYE"))).length ?? 0;
  const started = fixtures?.filter((f) => f.status === "LIVE" || f.status === "POSTPONED" || f.status === "CANCELLED" || (f.status === "COMPLETED" && f.slotA.kind !== "BYE" && f.slotB.kind !== "BYE")).length ?? 0;
  const separate = competition?.tournamentConfiguration?.separateColleges ?? true;
  const hasBracket = (fixtures?.length ?? 0) > 0;

  useEffect(() => {
    if (!entrants) {
      setSeedOrder([]);
      return;
    }
    const active = entrants.filter((e) => e.status !== "WITHDRAWN");
    setSeedOrder((prev) => {
      const kept = prev.filter((id) => active.some((e) => e.id === id));
      return [...kept, ...active.filter((e) => !kept.includes(e.id)).map((e) => e.id)];
    });
  }, [entrants]);

  useEffect(() => {
    setMessage(null);
    setSheet(null);
  }, [competitionId]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "sport") next.delete("comp");
    setParams(next, { replace: true });
  };

  const move = (index: number, dir: -1 | 1) =>
    setSeedOrder((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const changeSeeding = async (value: Seeding, separateColleges = separate) => {
    setBusy(true);
    setMessage(null);
    try {
      await upsertEntity({ collection: "competitions", id: competitionId, data: { tournamentConfiguration: { seeding: value, byePolicy: "TOP_SEEDS", separateColleges } } });
      setMessage({ kind: "success", text: value === seeding ? "Draw settings saved." : `Seeding set to ${value.toLowerCase()}.` });
    } catch (err) {
      setMessage({ kind: "error", text: `Could not change seeding. ${describeError(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const runGenerate = async () => {
    const result = await generateBracket({ competitionId, ...(seedOrder.length > 0 && seeding === "MANUAL" ? { entrantIds: seedOrder } : {}) });
    setSheet(null);
    const draw = result.data.drawSeed !== undefined ? ` Draw number ${result.data.drawSeed} is saved in the audit log.` : "";
    setMessage({
      kind: "success",
      text: competition?.published
        ? `Bracket regenerated with ${result.data.fixtureCount} fixtures and is live on the public site.${draw}`
        : `Bracket generated with ${result.data.fixtureCount} fixtures.${draw} Review it below, then publish.`,
    });
  };

  const runPublish = async () => {
    await publishBracket({ competitionId });
    setSheet(null);
    setMessage({ kind: "success", text: "Published. The bracket and fixtures are now visible on the public site." });
  };

  const runWithdraw = async () => {
    if (!sheet || typeof sheet === "string") return;
    const { id, label } = sheet.withdraw;
    const collection = competition?.participantType === "TEAM" || competition?.participantType === "PAIR" ? "teams" : "participants";
    const result = await withdrawEntrant({ collection, id, reason: withdrawReason.trim() });
    setSheet(null);
    setWithdrawReason("");
    const n = result.data.affectedFixtureIds.length;
    setMessage({
      kind: "success",
      text:
        n === 0
          ? `${label} withdrawn. They aren't in any unfinished fixture.`
          : `${label} withdrawn. They are still in ${n} unfinished fixture${n === 1 ? "" : "s"}. Nothing was re-bracketed; resolve each one with a walkover.`,
    });
  };

  const seedLabel = useMemo(() => new Map((entrants ?? []).map((e) => [e.id, e.label])), [entrants]);

  return (
    <div className="admin-page">
      <h1 className="admin-page__title">Brackets</h1>

      <section className="admin-card admin-card--row">
        <label className="admin-field" htmlFor={sportSelectId}>
          <span className="admin-field__label">Sport</span>
          <select id={sportSelectId} className="admin-input" value={sportId} onChange={(e) => setParam("sport", e.target.value)}>
            <option value="">Select sport</option>
            {(sports ?? []).map((s) => (
              <option key={s.sportId} value={s.sportId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field" htmlFor={competitionSelectId}>
          <span className="admin-field__label">Competition</span>
          <select id={competitionSelectId} className="admin-input" value={competitionId} disabled={!sportId} onChange={(e) => setParam("comp", e.target.value)}>
            <option value="">Select competition</option>
            {(competitions ?? []).map((c) => (
              <option key={c.competitionId} value={c.competitionId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <ActionStatus message={message} />

      {readError && <ErrorState title="Bracket data couldn't be loaded" hint="Check your connection and try again." onRetry={retryReads} />}

      {!readError && !competition && <p className="admin-empty">Choose a sport and competition to manage its bracket.</p>}

      {!readError && competition && (
        <>
          <section className="admin-card">
            <h2 className="admin-card__title">
              {competition.name}
              <span className={`admin-badge ${competition.published ? "admin-badge--ok" : "admin-badge--warning"}`}>{competition.published ? "Published" : "Not published"}</span>
            </h2>
            <dl className="admin-facts">
              <div><dt>Entrants</dt><dd>{entrants ? entrants.length : "…"}</dd></div>
              <div><dt>Fixtures</dt><dd>{fixtures ? fixtures.length : "…"}</dd></div>
              <div><dt>Draft</dt><dd>{drafts}</dd></div>
              <div><dt>Started or played</dt><dd>{operational}</dd></div>
            </dl>

            <label className="admin-field" htmlFor={seedingId}>
              <span className="admin-field__label">Seeding</span>
              <select id={seedingId} className="admin-input" value={seeding} disabled={busy} onChange={(e) => void changeSeeding(e.target.value as Seeding)}>
                <option value="MANUAL">Manual: use the seed order below</option>
                <option value="RANDOM">Random: shuffled each time you generate</option>
              </select>
            </label>
            {seeding === "RANDOM" && (
              <label className="admin-check">
                <input type="checkbox" checked={separate} disabled={busy} onChange={(e) => void changeSeeding("RANDOM", e.target.checked)} />
                <span>Keep entrants from the same college apart in the first round where possible</span>
              </label>
            )}

            <div className="admin-actions">
              <button type="button" className="admin-btn admin-btn--primary" disabled={busy || fixtures === null || started > 0} onClick={() => setSheet("generate")}>
                {hasBracket ? "Regenerate bracket" : "Generate bracket"}
              </button>
              <button type="button" className="admin-btn admin-btn--danger" disabled={busy || fixtures === null || competition.published || !hasBracket} onClick={() => setSheet("publish")}>
                Publish
              </button>
            </div>
            {started > 0 && <p className="admin-hint">Regeneration is blocked once any match has started, been played, postponed or cancelled.</p>}
            {started === 0 && competition.published && hasBracket && <p className="admin-hint">No match has started yet, so the published bracket can still be regenerated, for example for a late entry. Saved schedules are kept.</p>}
          </section>

          {seeding === "MANUAL" && seedOrder.length > 0 && (
            <section className="admin-card">
              <h2 className="admin-card__title">Seed order</h2>
              <p className="admin-hint">Seed 1 first. Leave as is for an arbitrary order.</p>
              <ol className="seed-list">
                {seedOrder.map((id, i) => (
                  <li key={id}>
                    <span className="seed-list__rank">{i + 1}</span>
                    <span className="seed-list__label">{seedLabel.get(id) ?? id}</span>
                    <button type="button" className="admin-btn admin-btn--icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${seedLabel.get(id) ?? id} up`}>↑</button>
                    <button type="button" className="admin-btn admin-btn--icon" disabled={i === seedOrder.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${seedLabel.get(id) ?? id} down`}>↓</button>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="admin-card">
            <h2 className="admin-card__title">Bracket</h2>
            {fixtures === null ? (
              <LoadingState label="Loading bracket" rows={3} />
            ) : (
              <BracketView competitionId={competition.competitionId} includeDrafts sport={sport} onOpenFixture={(id) => navigate(`/admin/fixtures/${id}/live`)} />
            )}
          </section>

          {entrants && entrants.length > 0 && (
            <section className="admin-card">
              <h2 className="admin-card__title">Withdraw an entrant</h2>
              <p className="admin-hint">Marks the entrant withdrawn. Nothing is re-bracketed automatically. Any unfinished fixtures they are in are reported for you to resolve.</p>
              <ul className="admin-list">
                {entrants.map((e) => (
                  <li key={e.id}>
                    <span>{e.label}</span>
                    {e.status === "WITHDRAWN" ? (
                      <span className="admin-badge">Withdrawn</span>
                    ) : (
                      <button type="button" className="admin-btn admin-btn--small" onClick={() => { setWithdrawReason(""); setSheet({ withdraw: { id: e.id, label: e.label } }); }}>
                        Withdraw
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <AnimatePresence>
        {sheet === "generate" && (
          <ConfirmSheet key="generate" title={hasBracket ? "Regenerate bracket?" : "Generate bracket?"} confirmLabel={hasBracket ? "Regenerate" : "Generate"} onConfirm={runGenerate} onClose={() => setSheet(null)}>
            <p>
              {hasBracket
                ? "The existing draft bracket for this competition will be replaced using the current seeding."
                : "A draft bracket will be created from the current entrants. It stays hidden until you publish."}
            </p>
          </ConfirmSheet>
        )}
        {sheet === "publish" && (
          <ConfirmSheet key="publish" title="Publish this bracket?" tone="danger" confirmLabel="Publish" onConfirm={runPublish} onClose={() => setSheet(null)}>
            <p>The competition and its {fixtures?.length ?? 0} fixtures become visible on the public site. Publishing can't be undone from here.</p>
          </ConfirmSheet>
        )}
        {sheet && typeof sheet === "object" && (
          <ConfirmSheet
            key="withdraw"
            title={`Withdraw ${sheet.withdraw.label}?`}
            tone="danger"
            confirmLabel="Withdraw"
            confirmDisabled={!withdrawReason.trim()}
            onConfirm={runWithdraw}
            onClose={() => setSheet(null)}
          >
            <label className="admin-field">
              <span className="admin-field__label">Reason (required)</span>
              <input className="admin-input" value={withdrawReason} maxLength={500} onChange={(e) => setWithdrawReason(e.target.value)} placeholder="e.g. injury, no-show" />
            </label>
          </ConfirmSheet>
        )}
      </AnimatePresence>
    </div>
  );
}
