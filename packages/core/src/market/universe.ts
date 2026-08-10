import { sha256Hex } from '../crypto/sha256.js';
import { instrumentKey, type InstrumentIdentity, type InstrumentKey } from '../types/index.js';
import { utcDayKey } from './market-bars.js';

const DAY_MS = 86_400_000;

export interface UniverseProductObservation {
  readonly instrument: InstrumentIdentity;
  readonly baseAsset: string;
  readonly quoteAsset: 'USD';
  readonly status: string;
  readonly tradingDisabled: boolean | null;
  readonly cancelOnly: boolean | null;
  readonly limitOnly: boolean | null;
  readonly postOnly: boolean | null;
  readonly baseIncrement: string | null;
  readonly quoteIncrement: string | null;
  readonly minMarketFunds: string | null;
}

export interface PointInTimeUniverseSnapshot {
  readonly id: string;
  readonly source: 'coinbase-products';
  readonly observedAtMs: number;
  /** Conservative daily use: an observation never affects its own UTC day. */
  readonly effectiveFromDayKey: string;
  readonly products: readonly UniverseProductObservation[];
  readonly snapshotHash: string;
}

export type UniverseExclusionReason =
  | 'status_not_online'
  | 'trading_disabled'
  | 'rules_unknown'
  | 'cancel_only'
  | 'limit_only'
  | 'post_only';

export interface UniverseDayMembership {
  readonly dayKey: string;
  readonly snapshotId: string;
  readonly snapshotHash: string;
  readonly observedAtMs: number;
  readonly eligibleAssets: readonly InstrumentKey[];
  readonly excludedAssets: Readonly<Record<InstrumentKey, readonly UniverseExclusionReason[]>>;
}

export interface PointInTimeUniverseTimeline {
  readonly policy: 'daily-observation';
  readonly requestedDayKeys: readonly string[];
  readonly membershipsByDay: Readonly<Record<string, UniverseDayMembership>>;
  readonly uncoveredDayKeys: readonly string[];
  readonly timelineHash: string;
}

function nextUtcDayKey(observedAtMs: number): string {
  return utcDayKey(Math.floor(observedAtMs / DAY_MS) * DAY_MS + DAY_MS);
}

function canonicalProducts(
  products: readonly UniverseProductObservation[],
): UniverseProductObservation[] {
  const result = new Map<InstrumentKey, UniverseProductObservation>();
  for (const product of products) {
    const key = instrumentKey(product.instrument);
    if (product.instrument.venue !== 'coinbase' || product.instrument.productType !== 'spot') {
      throw new TypeError('Universe products must be Coinbase spot instruments.');
    }
    if (!product.baseAsset.trim() || product.quoteAsset !== 'USD' || !product.status.trim()) {
      throw new TypeError('Universe products require base, USD quote, and status metadata.');
    }
    if (result.has(key)) throw new Error(`Duplicate universe product identity: ${key}.`);
    result.set(key, { ...product, instrument: { ...product.instrument } });
  }
  return [...result.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([, product]) => product);
}

function snapshotMaterial(
  observedAtMs: number,
  effectiveFromDayKey: string,
  products: readonly UniverseProductObservation[],
): string {
  return JSON.stringify({
    schemaVersion: 1,
    source: 'coinbase-products',
    observedAtMs,
    effectiveFromDayKey,
    products: products.map((product) => ({
      key: instrumentKey(product.instrument),
      baseAsset: product.baseAsset,
      quoteAsset: product.quoteAsset,
      status: product.status,
      tradingDisabled: product.tradingDisabled,
      cancelOnly: product.cancelOnly,
      limitOnly: product.limitOnly,
      postOnly: product.postOnly,
      baseIncrement: product.baseIncrement,
      quoteIncrement: product.quoteIncrement,
      minMarketFunds: product.minMarketFunds,
    })),
  });
}

/** Create one immutable, content-addressed full Coinbase product observation. */
export function createPointInTimeUniverseSnapshot(
  observedAtMs: number,
  products: readonly UniverseProductObservation[],
): PointInTimeUniverseSnapshot {
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs <= 0) {
    throw new TypeError('Universe observation time must be a positive safe integer.');
  }
  const canonical = canonicalProducts(products);
  const effectiveFromDayKey = nextUtcDayKey(observedAtMs);
  const snapshotHash = sha256Hex(snapshotMaterial(observedAtMs, effectiveFromDayKey, canonical));
  return deepFreeze({
    id: snapshotHash,
    source: 'coinbase-products',
    observedAtMs,
    effectiveFromDayKey,
    products: canonical,
    snapshotHash,
  });
}

function exclusionReasons(product: UniverseProductObservation): UniverseExclusionReason[] {
  const reasons: UniverseExclusionReason[] = [];
  if (product.status !== 'online') reasons.push('status_not_online');
  if (product.tradingDisabled === true) reasons.push('trading_disabled');
  if ([product.tradingDisabled, product.cancelOnly, product.limitOnly, product.postOnly]
    .some((flag) => flag === null)) reasons.push('rules_unknown');
  if (product.cancelOnly === true) reasons.push('cancel_only');
  if (product.limitOnly === true) reasons.push('limit_only');
  if (product.postOnly === true) reasons.push('post_only');
  return reasons;
}

function membership(
  dayKey: string,
  snapshot: PointInTimeUniverseSnapshot,
): UniverseDayMembership {
  const eligibleAssets: InstrumentKey[] = [];
  const excludedAssets: Record<InstrumentKey, UniverseExclusionReason[]> = {};
  for (const product of snapshot.products) {
    const key = instrumentKey(product.instrument);
    const reasons = exclusionReasons(product);
    if (reasons.length === 0) eligibleAssets.push(key);
    else excludedAssets[key] = reasons;
  }
  return {
    dayKey,
    snapshotId: snapshot.id,
    snapshotHash: snapshot.snapshotHash,
    observedAtMs: snapshot.observedAtMs,
    eligibleAssets,
    excludedAssets,
  };
}

/**
 * Build strict daily memberships. A missing prior-day observation is uncovered;
 * snapshots are never carried backward or silently carried across missed days.
 */
export function buildPointInTimeUniverseTimeline(
  snapshots: readonly PointInTimeUniverseSnapshot[],
  dayKeys: readonly string[],
): PointInTimeUniverseTimeline {
  const requested = [...new Set(dayKeys)].sort();
  for (const dayKey of requested) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || utcDayKey(Date.parse(`${dayKey}T00:00:00Z`)) !== dayKey) {
      throw new TypeError(`Invalid UTC universe day key: ${dayKey}.`);
    }
  }
  const byEffectiveDay = new Map<string, PointInTimeUniverseSnapshot>();
  for (const snapshot of snapshots) {
    const rebuilt = createPointInTimeUniverseSnapshot(snapshot.observedAtMs, snapshot.products);
    if (rebuilt.snapshotHash !== snapshot.snapshotHash || rebuilt.id !== snapshot.id) {
      throw new Error('Universe snapshot integrity validation failed.');
    }
    const current = byEffectiveDay.get(snapshot.effectiveFromDayKey);
    if (!current || current.observedAtMs < snapshot.observedAtMs) {
      byEffectiveDay.set(snapshot.effectiveFromDayKey, snapshot);
    }
  }
  const membershipsByDay: Record<string, UniverseDayMembership> = {};
  const uncoveredDayKeys: string[] = [];
  for (const dayKey of requested) {
    const snapshot = byEffectiveDay.get(dayKey);
    if (!snapshot) uncoveredDayKeys.push(dayKey);
    else membershipsByDay[dayKey] = membership(dayKey, snapshot);
  }
  const timelineHash = sha256Hex(JSON.stringify({
    policy: 'daily-observation',
    requestedDayKeys: requested,
    days: requested.map((dayKey) => {
      const value = membershipsByDay[dayKey];
      return value ? [dayKey, value.snapshotHash, value.eligibleAssets, value.excludedAssets]
        : [dayKey, null];
    }),
  }));
  return deepFreeze({
    policy: 'daily-observation', requestedDayKeys: requested,
    membershipsByDay, uncoveredDayKeys, timelineHash,
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
