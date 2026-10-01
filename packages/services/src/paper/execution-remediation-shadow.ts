import { Decimal } from 'decimal.js';
import { EXECUTION_ARMS, planExecution, openingMatchedBook, modelMarketFill,
  validateStudyProvenance, STUDY_BEHAVIOR_HASHES, type ExecutionArm, type ExecutionAsset,
  type ExecutionTarget, type ExecutionSnapshot, type RemediationBookObservation, type ExecutionPlan, type CanonicalJsonValue } from '@coqui/core';
import type { createAlpacaPaperClient } from '@coqui/adapters';
import { listStudyInstances, listRemediationEvidence, appendRemediationEvidence, type Db } from '@coqui/storage';
import { parallelQuotes } from './parallel-paper-intraday.js';
import { PARALLEL_INSTRUMENTS, PARALLEL_SYMBOLS } from './parallel-signal.js';
import { instrumentKey } from '@coqui/core';

export const REMEDIATION_CANDIDATE = 'trendvol-execution-remediation-v1';
export interface RemediationFrame {
  readonly slotMs: number; readonly capturedAtMs: number; readonly target: ExecutionTarget;
  readonly assets: readonly ExecutionAsset[];
}
/** One independent, cash-conserving simulated arm. No credentials or order port. */
export function advanceRemediationBook(frame: RemediationFrame, arm: ExecutionArm, multiplier: 1 | 2,
  previous: RemediationBookObservation | null, namespace: string): RemediationBookObservation {
  let state = previous?.state ?? openingMatchedBook();
  const changed = previous?.target.id !== frame.target.id;
  const priorTarget = changed ? previous?.target ?? null : previous.previousTarget;
  let fulfilled = changed ? [] : [...previous.fulfilled];
  const passive = arm.startsWith('passive-');
  const target: ExecutionTarget = passive ? { ...frame.target, id: `control:${arm}`,
    weights: Object.fromEntries(frame.assets.map((asset) => [asset.id,
      arm === 'passive-btc' ? (asset.symbol.replace('/', '') === 'BTCUSD' ? '1' : '0') : '0.333333333333333333333333333333'])) } : frame.target;
  const plans: ExecutionPlan[] = [];
  if (arm !== 'cash' && !(passive && previous)) for (const stage of ['sell','buy'] as const) {
    const assets = frame.assets.map((asset) => ({ ...asset, held: state.quantities[asset.id] ?? '0',
      marketValue: new Decimal(state.quantities[asset.id] ?? '0').mul(new Decimal(asset.bid).plus(asset.ask).div(2)).toString() }));
    const equity = assets.reduce((sum,asset) => sum.plus(asset.marketValue), new Decimal(state.cash));
    const snapshot: ExecutionSnapshot = { atMs: frame.capturedAtMs, accountAtMs: frame.capturedAtMs,
      positionsAtMs: frame.capturedAtMs, cash: state.cash, equity: equity.toString(), assets };
    const plan = planExecution({ namespace, revision: plans.length, slotMs: frame.slotMs, nowMs: frame.capturedAtMs,
      policy: passive ? 'B' : arm, stage, target, previousTarget: priorTarget, snapshot,
      fulfilledAssetIds: fulfilled, pendingAssetIds: state.pending, reservedCash: '0', costMultiplier: multiplier,
      limits: { maxOrders: 3, maxTurnoverUsd: equity.toString(), maxOrderUsd: equity.toString(),
        maxPositionWeight: '1', maxInvestedWeight: '1' } });
    plans.push(plan); fulfilled = [...plan.fulfilledAssetIds];
    for (const intent of plan.orders) {
      const asset = assets.find((item) => item.id === intent.assetId)!;
      state = modelMarketFill(state, intent, asset, multiplier);
    }
  }
  const equity = frame.assets.reduce((sum,asset) => sum.plus(new Decimal(state.quantities[asset.id] ?? '0')
    .mul(new Decimal(asset.bid).plus(asset.ask).div(2))), new Decimal(state.cash));
  return { state, target: frame.target, previousTarget: priorTarget, fulfilled, arm, multiplier, plans,
    equityUsd: equity.toString(), modeledOnly: true };
}

export async function collectExecutionRemediationShadow(input: {
  readonly profileId: string; readonly experimentId: string; readonly db: Db; readonly now: () => number;
  readonly target: ExecutionTarget; readonly completedCloses: Readonly<Record<string,string>>;
  readonly read: Pick<ReturnType<typeof createAlpacaPaperClient>, 'latestCryptoQuotes' | 'asset'>;
}): Promise<void> {
  const instance = listStudyInstances(input.profileId, REMEDIATION_CANDIDATE, input.db).at(-1);
  if (!instance) return;
  const now = input.now(), slotMs = Math.floor(now / 14_400_000) * 14_400_000;
  if (now >= slotMs + 900_000 || slotMs < instance.definition.startMs || slotMs > instance.definition.holdoutEndMs) return;
  const append = (kind: string, key: string, body: unknown) => appendRemediationEvidence({ profileId: input.profileId,
    namespace: instance.id, kind, key, atMs: input.now(), body: body as CanonicalJsonValue }, input.db);
  try {
    validateStudyProvenance(instance, { profileId: input.profileId, experimentId: input.experimentId,
      candidateId: REMEDIATION_CANDIDATE, behaviorHash: STUDY_BEHAVIOR_HASHES[REMEDIATION_CANDIDATE] ?? '' });
    let record = listRemediationEvidence(input.profileId, instance.id, 'frame', input.db).find((r) => r.key === String(slotMs));
    if (!record) {
      const [raw, ...rules] = await Promise.all([input.read.latestCryptoQuotes(), ...PARALLEL_SYMBOLS.map((symbol) => input.read.asset(symbol))]);
      const capturedAtMs = input.now(), quotes = parallelQuotes(raw, capturedAtMs);
      if (capturedAtMs >= slotMs + 900_000) throw new Error('deadline_exceeded');
      const assets = PARALLEL_INSTRUMENTS.map((instrument,index): ExecutionAsset => {
        const id = instrumentKey(instrument), symbol = PARALLEL_SYMBOLS[index]!, rule = rules[index]!;
        if (rule.symbol.replace('/', '') !== symbol) throw new Error('asset_identity_mismatch');
        return { id, symbol, held: '0', marketValue: '0', ...quotes.sides[symbol]!, quoteAtMs: quotes.sides[symbol]!.atMs,
          rulesAtMs: capturedAtMs, tradable: rule.tradable, status: rule.status,
          increment: rule.min_trade_increment ?? '0', minimum: rule.min_order_size ?? '0',
          completedClose: input.completedCloses[id] ?? '0' };
      });
      append('frame', String(slotMs), { slotMs, capturedAtMs, target: input.target, assets });
      record = listRemediationEvidence(input.profileId, instance.id, 'frame', input.db).find((r) => r.key === String(slotMs));
    }
    const frame = record!.body as unknown as RemediationFrame;
    // The boundary frame marks the preceding book without trading it. New phases get separate books.
    if (slotMs === instance.definition.holdoutEndMs) return;
    const starts = [instance.definition.startMs, ...instance.definition.foldEndsMs];
    const phaseStart = starts.filter((at) => at <= slotMs).at(-1)!;
    for (const arm of EXECUTION_ARMS) for (const multiplier of [1,2] as const) {
      const kind = `book:${phaseStart}:${arm}:${multiplier}`, key = String(slotMs);
      const records = listRemediationEvidence(input.profileId, instance.id, kind, input.db);
      if (records.some((r) => r.key === key)) continue;
      const previous = records.at(-1)?.body as unknown as RemediationBookObservation | undefined;
      // A missing predecessor is coverage failure, not permission to skip time or reset holdings.
      if ((!previous && slotMs !== phaseStart) || (records.at(-1) && Number(records.at(-1)!.key) !== slotMs - 14_400_000))
        throw new Error('missing_prospective_predecessor');
      append(kind,key,advanceRemediationBook(frame,arm,multiplier,previous ?? null,`${instance.id}:${kind}`));
    }
  } catch (error) {
    const reason = error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : 'shadow_unavailable';
    const key = `${slotMs}:${reason}`;
    if (!listRemediationEvidence(input.profileId, instance.id, 'failure', input.db).some((r) => r.key === key))
      append('failure', key, { slotMs, reason, executionEnabled: false });
  }
}
