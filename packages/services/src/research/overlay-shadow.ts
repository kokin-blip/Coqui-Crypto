import { Decimal } from 'decimal.js';
import { decideOverlayShadow, overlayCandidates, overlayHash, overlayPlanHash, validateOverlayArtifact, costScenarioHash,
  rebalanceResearchBook, researchBookValue, sourceCompletionDelayMs, type OverlayStudyPlan, type OverlayArtifact, type OverlayRiskState,
  type ResearchBook, type DecisionMarketDataset, type InstrumentKey, type CanonicalJsonValue, type LiquidityObservation } from '@coqui/core';
import { appendIntegrityEvent, listIntegrityEvents, inTransaction, type Db } from '@coqui/storage';
export interface ShadowBinding {
  readonly plan: OverlayStudyPlan; readonly scenarioHash: string;
  readonly arms: readonly { readonly cadence: 1 | 14; readonly candidateId: string; readonly artifact: OverlayArtifact | null; readonly artifactHash: string | null }[];
}
interface BookState { lastAccrualMs?: number; cash: string; units: readonly (readonly [InstrumentKey, string])[]; risk: OverlayRiskState; markedEquity: string; fills: number; cost: string }
const namespace = (profile: string) => `overlay-shadow:${JSON.stringify(profile)}`;
const json = (v: unknown) => v as CanonicalJsonValue;
function latest<T>(profile: string, kind: string, db: Db): T | null { return listIntegrityEvents(namespace(profile), kind, db).at(-1)?.body as T ?? null; }
export function setOverlayShadowEnabled(profile: string, enabled: boolean, commandId: string, atMs: number, db: Db): void {
  const events = listIntegrityEvents(namespace(profile), 'shadow_setting', db); if (events.some((e) => e.key === commandId)) return;
  appendIntegrityEvent({ namespace: namespace(profile), kind: 'shadow_setting', key: commandId, atMs, body: { enabled } }, db);
}
export function importOverlayShadowBinding(profile: string, binding: ShadowBinding, contentHash: string, atMs: number, db: Db): void {
  if (overlayHash(binding) !== contentHash || binding.arms.length !== 2 || ![1, 14].every((c) => binding.arms.some((a) => a.cadence === c))) throw new Error('shadow_binding_integrity');
  const planHash = overlayPlanHash(binding.plan), scenario = binding.plan.scenarios.find((s) => costScenarioHash(s) === binding.scenarioHash);
  if (!scenario) throw new Error('shadow_cost_identity');
  for (const arm of binding.arms) {
    const candidate = overlayCandidates().find((c) => c.id === arm.candidateId && c.cadence === arm.cadence && !c.diagnosticOnly);
    if (!candidate || (arm.artifact === null ? arm.artifactHash !== null : overlayHash(arm.artifact) !== arm.artifactHash)) throw new Error('shadow_candidate_integrity');
    if (arm.artifact) {
      validateOverlayArtifact(arm.artifact, binding.plan, candidate, scenario.config);
      const frozen = listIntegrityEvents(planHash, 'overlay_freeze', db)[0]?.body as unknown as { artifacts: Record<string, OverlayArtifact | null> } | undefined;
      if (!frozen || overlayHash(frozen.artifacts[`${candidate.id}:${binding.scenarioHash}`] ?? null) !== arm.artifactHash || !arm.artifact.evaluationResultHash) throw new Error('shadow_artifact_not_frozen');
    }
  }
  // Explicit updates take effect only after old pending actions finish; never rewrite a pending decision.
  if (listIntegrityEvents(namespace(profile), 'shadow_pending', db).some((e) => !listIntegrityEvents(namespace(profile), 'shadow_settlement', db).some((s) => s.key === e.key))) throw new Error('shadow_pending_update_refused');
  const existing = latest<ShadowBinding>(profile, 'shadow_binding', db);
  if (existing && overlayHash(existing) !== contentHash) {
    // Changing a configuration starts distinct books; previous evidence is retained under its binding hash.
    appendIntegrityEvent({ namespace: namespace(profile), kind: 'shadow_binding', key: `${atMs}:${contentHash}`, atMs, body: json(binding) }, db);
  } else if (!existing) appendIntegrityEvent({ namespace: namespace(profile), kind: 'shadow_binding', key: `${atMs}:${contentHash}`, atMs, body: json(binding) }, db);
}
export interface ObservedShadowOpen { readonly barStartMs: number; readonly observedAtMs: number; readonly sourceHash: string; readonly prices: ReadonlyMap<InstrumentKey, number> }
function initial(): BookState { return { cash: '10000', units: [], markedEquity: '10000', risk: { peak: 10000, priorObserved: 10000, stopped: false }, fills: 0, cost: '0' }; }
function state(profile: string, bindingHash: string, cadence: number, db: Db): BookState {
  const events = listIntegrityEvents(namespace(profile), 'shadow_book', db);
  const existing = events.filter((e) => e.key.startsWith(`${bindingHash}:${cadence}:`)).at(-1)?.body as unknown as BookState | undefined;
  const stopped = events.some((e) => e.key.split(':')[1] === String(cadence) && (e.body as unknown as BookState).risk.stopped);
  const book = existing ?? initial(); return { ...book, risk: { ...book.risk, stopped: book.risk.stopped || stopped } };
}
export function readOverlayShadowStatus(profile: string, atMs: number, db: Db) {
  const enabled = latest<{ enabled: boolean }>(profile, 'shadow_setting', db)?.enabled ?? false;
  const binding = latest<ShadowBinding>(profile, 'shadow_binding', db), hash = binding ? overlayHash(binding) : null;
  const refusal = listIntegrityEvents(namespace(profile), 'shadow_refusal', db).filter((e) => hash !== null && e.key.startsWith(hash)).at(-1);
  const settlements = listIntegrityEvents(namespace(profile), 'shadow_settlement', db), pending = listIntegrityEvents(namespace(profile), 'shadow_pending', db);
  return { enabled, mode: 'research_shadow' as const, qualified: false as const, updatePolicy: 'explicit' as const, asOfMs: atMs,
    bindingHash: hash, pending: pending.filter((e) => !settlements.some((s) => s.key === e.key)).length,
    arms: binding ? binding.arms.map((arm) => { const book = state(profile, hash!, arm.cadence, db); return { cadence: arm.cadence,
      candidateId: arm.candidateId, artifactHash: arm.artifactHash, equityUsd: book.markedEquity, netPnlUsd: new Decimal(book.markedEquity).sub(10000).toFixed(),
      costUsd: book.cost, modeledFills: book.fills, stopped: book.risk.stopped }; }) : [],
    reason: !enabled ? 'disabled' : !binding ? 'configuration_required' : refusal && refusal.atMs >= (pending.at(-1)?.atMs ?? 0) ? 'data_unavailable' : 'observing' };
}
/** No broker, execution service, permissions, or active portfolio dependencies exist at this boundary. */
export function tickOverlayShadow(input: { profile: string; atMs: number; dataset: DecisionMarketDataset;
  open?: ObservedShadowOpen | null; safetyStopped?: boolean; liquidity?: readonly LiquidityObservation[]; db: Db }): void {
  const { profile, atMs, db, dataset } = input;
  if (!latest<{ enabled: boolean }>(profile, 'shadow_setting', db)?.enabled) return;
  const binding = latest<ShadowBinding>(profile, 'shadow_binding', db); if (!binding) return;
  const bindingHash = overlayHash(binding), scenario = binding.plan.scenarios.find((s) => costScenarioHash(s) === binding.scenarioHash)!;
  const day = Math.floor(atMs / 86_400_000) * 86_400_000;
  inTransaction(db, () => {
    const settled = new Set(listIntegrityEvents(namespace(profile), 'shadow_settlement', db).map((e) => e.key));
    for (const event of listIntegrityEvents(namespace(profile), 'shadow_pending', db)) {
      if (settled.has(event.key)) continue;
      const pending = event.body as unknown as { cadence: number; bindingHash: string; decision: ReturnType<typeof decideOverlayShadow> };
      const decision = pending.decision;
      if (atMs < decision.executionAtMs) continue;
      const open = input.open;
      const timely = open && open.barStartMs === decision.executionAtMs && open.observedAtMs >= open.barStartMs &&
        open.observedAtMs <= open.barStartMs + 60_000 && open.observedAtMs <= atMs && event.atMs < open.barStartMs &&
        /^[a-f0-9]{64}$/u.test(open.sourceHash) && dataset.assets.every((a) => Number.isFinite(open.prices.get(a)) && open.prices.get(a)! > 0);
      if (!timely && atMs <= decision.executionAtMs + 60_000) continue;
      const current = state(profile, pending.bindingHash, pending.cadence, db);
      const cash = new Decimal(current.cash).mul(Math.pow(1 + binding.plan.execution.cashAprPct / 100, Math.max(0, decision.executionAtMs - (current.lastAccrualMs ?? event.atMs)) / (365 * 86_400_000))).toFixed();
      const book: ResearchBook = { cash, units: new Map(current.units) };
      const safetyStopped = input.safetyStopped === true || current.risk.stopped || decision.risk.stopped;
      let fill = timely && (decision.act || safetyStopped) ? rebalanceResearchBook(book, open.prices, safetyStopped ? new Map() : new Map(decision.targets.map((t) => [t.assetId, t.weight])), scenario.config) : { book, fills: [] };
      let fillReason = safetyStopped ? 'hard_safety_stop' : decision.reason;
      if (timely && !safetyStopped && decision.reason === 'bounded_tilt') {
        const caps = new Map(decision.liquidityCaps.map((c) => [c.assetId, c.maxUsd]));
        if (fill.fills.some((f) => new Decimal(f.referenceNotional).gt(caps.get(f.assetId) ?? 0))) {
          fill = rebalanceResearchBook(book, open.prices, new Map(decision.baselineTargets.map((t) => [t.assetId, t.weight])), scenario.config);
          fillReason = 'liquidity_execution_baseline_fallback';
        }
      }
      const cost = fill.fills.reduce((s, f) => s.add(f.totalCost), new Decimal(current.cost));
      const marks = timely ? open.prices : new Map(dataset.assets.map((a) => [a, dataset.closesById[a]!.at(-1)!]));
      const next: BookState = { lastAccrualMs: decision.executionAtMs, cash: fill.book.cash, units: [...fill.book.units], risk: { ...decision.risk, stopped: safetyStopped },
        markedEquity: researchBookValue(fill.book, marks).toFixed(), fills: current.fills + fill.fills.length, cost: cost.toFixed() };
      appendIntegrityEvent({ namespace: namespace(profile), kind: 'shadow_book', key: event.key, atMs, body: json(next) }, db);
      appendIntegrityEvent({ namespace: namespace(profile), kind: 'shadow_settlement', key: event.key, atMs,
        body: json({ fillReason, status: timely ? 'observed_open' : 'missed_open_no_backfill', observedAtMs: timely ? open.observedAtMs : null,
          sourceHash: timely ? open.sourceHash : null, fills: fill.fills, equity: next.markedEquity }) }, db);
    }
    for (const arm of binding.arms) {
      const lastBar = dataset.barsById[dataset.assets[0]!]!.at(-1);
      if (!lastBar || atMs < day + sourceCompletionDelayMs(lastBar.source)) continue;
      const executionAtMs = day + 86_400_000, key = `${bindingHash}:${arm.cadence}:${executionAtMs}`;
      if (listIntegrityEvents(namespace(profile), 'shadow_pending', db).some((e) => e.key === key)) continue;
      const book = state(profile, bindingHash, arm.cadence, db), candidate = overlayCandidates().find((c) => c.id === arm.candidateId)!;
      let decision: ReturnType<typeof decideOverlayShadow>;
      try { if (lastBar.endTimeMs !== day) throw new Error('shadow_latest_publication_missing');
        decision = decideOverlayShadow({ dataset, plan: binding.plan, candidate, book: { cash: book.cash, units: new Map(book.units) },
        risk: { ...book.risk, stopped: book.risk.stopped || input.safetyStopped === true }, decisionAtMs: atMs, executionAtMs, costs: scenario.config, artifact: arm.artifact, liquidity: input.liquidity ?? [] }); } catch {
        if (!listIntegrityEvents(namespace(profile), 'shadow_refusal', db).some((e) => e.key === key))
          appendIntegrityEvent({ namespace: namespace(profile), kind: 'shadow_refusal', key, atMs, body: { reason: 'invalid_or_stale_decision_inputs' } }, db);
        continue;
      }
      appendIntegrityEvent({ namespace: namespace(profile), kind: 'shadow_pending', key, atMs, body: json({ bindingHash, cadence: arm.cadence, decision }) }, db);
    }
  });
}

export function exportOverlayShadowBinding(hash: string, scenarioName: string, candidateIds: readonly string[], db: Db) {
  const plan = listIntegrityEvents(hash, 'overlay_plan', db)[0]?.body as unknown as OverlayStudyPlan | undefined;
  const freeze = listIntegrityEvents(hash, 'overlay_freeze', db)[0]?.body as unknown as { selected: readonly string[]; artifacts: Record<string, OverlayArtifact | null> } | undefined;
  if (!plan || !freeze || overlayPlanHash(plan) !== hash || candidateIds.length !== 2) throw new Error('shadow_export_requires_freeze');
  const scenario = plan.scenarios.find((s) => s.scenario === scenarioName); if (!scenario) throw new Error('shadow_export_scenario');
  const scenarioHash = costScenarioHash(scenario);
  const arms = candidateIds.map((id, index) => {
    const cadence = index === 0 ? 1 : 14;
    const candidate = overlayCandidates().find((c) => c.id === id && c.cadence === cadence && !c.diagnosticOnly);
    if (!candidate || (!freeze.selected.includes(id) && !(candidate.gate === 'none' && candidate.model === 'none'))) throw new Error('shadow_export_candidate');
    const artifact = freeze.artifacts[`${id}:${scenarioHash}`] ?? null;
    return { cadence: cadence as 1 | 14, candidateId: id, artifact, artifactHash: artifact ? overlayHash(artifact) : null };
  });
  const binding: ShadowBinding = { plan, scenarioHash, arms }; return { binding, contentHash: overlayHash(binding) };
}
