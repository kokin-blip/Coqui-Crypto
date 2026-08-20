import {
  instrumentKey,
  nonNegativeDecimal,
  type Clock,
  type InstrumentIdentity,
} from '@coqui/core';
import {
  appendAlertEvent,
  archiveVisibleAlertEvents,
  countUnreadAlertEvents,
  getAlertRuleConfig,
  insertAlertPriceTarget,
  listAlertPriceTargets,
  listVisibleAlertEvents,
  markVisibleAlertEventsRead,
  saveAlertRuleConfig,
  updateAlertPriceTarget,
  type Db,
  type StoredAlertEvent,
  type StoredAlertKind,
} from '@coqui/storage';

const PROFILE = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;
const STABLE_CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const EVENT_KEY = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PRODUCT = /^[A-Z0-9][A-Z0-9-]{0,29}-USD$/u;
const CONFIG_KEYS = [
  'driftEnabled', 'regimeEnabled', 'bigMoveEnabled', 'bigMovePct',
  'priceTargetEnabled', 'soundEnabled', 'quietHoursEnabled', 'quietStartHour',
  'quietEndHour',
] as const;

export interface AlertIdSource {
  nextId(): string;
}

export interface AlertRuleConfigInput {
  readonly driftEnabled: boolean;
  readonly regimeEnabled: boolean;
  readonly bigMoveEnabled: boolean;
  readonly bigMovePct: string;
  readonly priceTargetEnabled: boolean;
  readonly soundEnabled: boolean;
  readonly quietHoursEnabled: boolean;
  readonly quietStartHour: number;
  readonly quietEndHour: number;
}

export interface AlertRuleConfigView extends AlertRuleConfigInput {
  readonly source: 'default' | 'stored';
  readonly updatedAtMs: number | null;
}

export const DEFAULT_ALERT_RULE_CONFIG: AlertRuleConfigInput = Object.freeze({
  driftEnabled: true,
  regimeEnabled: true,
  bigMoveEnabled: true,
  bigMovePct: '10',
  priceTargetEnabled: true,
  soundEnabled: true,
  quietHoursEnabled: false,
  quietStartHour: 22,
  quietEndHour: 8,
});

export type AlertMutationIssueCode =
  | 'unknown_field'
  | 'invalid_profile'
  | 'invalid_boolean'
  | 'invalid_big_move_threshold'
  | 'invalid_quiet_hour'
  | 'invalid_instrument'
  | 'invalid_direction'
  | 'invalid_target_price'
  | 'invalid_target_id'
  | 'invalid_event_key'
  | 'invalid_kind'
  | 'invalid_severity'
  | 'invalid_reason_code'
  | 'invalid_evidence_hash'
  | 'invalid_occurred_at'
  | 'future_event'
  | 'invalid_id_source'
  | 'storage_conflict'
  | 'target_not_found';

export interface AlertMutationIssue {
  readonly path: readonly string[];
  readonly code: AlertMutationIssueCode;
}

export interface AddAlertPriceTargetInput {
  readonly instrument: InstrumentIdentity;
  readonly direction: 'above' | 'below';
  readonly priceUsd: string;
}

export interface RecordAlertInput {
  readonly eventKey: string;
  readonly kind: StoredAlertKind;
  readonly severity: 'info' | 'warn';
  readonly reasonCode: string;
  readonly evidenceHash: string;
  readonly instrument: InstrumentIdentity | null;
  readonly occurredAtMs: number;
}

export interface AlertsView {
  readonly asOfMs: number;
  readonly profileId: string;
  readonly unreadCount: number;
  readonly config: AlertRuleConfigView;
  readonly priceTargets: ReturnType<typeof listAlertPriceTargets>;
  readonly alerts: readonly StoredAlertEvent[];
}

export type AlertMutationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly AlertMutationIssue[] };

export interface AlertsServiceDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly idSource: AlertIdSource;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    [...expected].sort().every((key, index) => keys[index] === key);
}

function issue(path: readonly string[], code: AlertMutationIssueCode): AlertMutationIssue {
  return freeze({ path: [...path], code });
}

function safeNow(clock: Clock): number {
  const value = clock.nowMs();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Alert clock must return a non-negative safe epoch millisecond.');
  }
  return value;
}

function validInstrument(identity: InstrumentIdentity): boolean {
  try {
    instrumentKey(identity);
  } catch {
    return false;
  }
  return exactKeys(identity, ['venue', 'productId', 'productType']) &&
    identity.venue === 'coinbase' && identity.productType === 'spot' &&
    PRODUCT.test(identity.productId);
}

function positiveDecimal(value: unknown, maximum?: number): boolean {
  if (typeof value !== 'string') return false;
  try {
    const parsed = nonNegativeDecimal(value);
    const numeric = Number(parsed);
    return Number.isFinite(numeric) && numeric > 0 && (maximum === undefined || numeric <= maximum);
  } catch {
    return false;
  }
}

function validateConfig(input: AlertRuleConfigInput): readonly AlertMutationIssue[] {
  const issues: AlertMutationIssue[] = [];
  if (!exactKeys(input, CONFIG_KEYS)) issues.push(issue([], 'unknown_field'));
  for (const key of [
    'driftEnabled', 'regimeEnabled', 'bigMoveEnabled', 'priceTargetEnabled',
    'soundEnabled', 'quietHoursEnabled',
  ] as const) {
    if (typeof input[key] !== 'boolean') issues.push(issue([key], 'invalid_boolean'));
  }
  if (!positiveDecimal(input.bigMovePct, 100)) {
    issues.push(issue(['bigMovePct'], 'invalid_big_move_threshold'));
  }
  for (const key of ['quietStartHour', 'quietEndHour'] as const) {
    if (!Number.isSafeInteger(input[key]) || input[key] < 0 || input[key] > 23) {
      issues.push(issue([key], 'invalid_quiet_hour'));
    }
  }
  return freeze(issues);
}

function profileIssue(profileId: string): readonly AlertMutationIssue[] {
  return PROFILE.test(profileId) ? [] : [issue(['profileId'], 'invalid_profile')];
}

export class AlertsService {
  readonly #database: Db;
  readonly #clock: Clock;
  readonly #idSource: AlertIdSource;

  constructor(dependencies: AlertsServiceDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
    this.#idSource = dependencies.idSource;
  }

  view(profileId: string, limit = 50): AlertsView {
    if (!PROFILE.test(profileId) || !Number.isSafeInteger(limit) || limit <= 0 || limit > 500) {
      throw new TypeError('Alerts view requires a stable profile and limit in [1, 500].');
    }
    const stored = getAlertRuleConfig(profileId, this.#database);
    const config: AlertRuleConfigView = stored ? {
      driftEnabled: stored.driftEnabled,
      regimeEnabled: stored.regimeEnabled,
      bigMoveEnabled: stored.bigMoveEnabled,
      bigMovePct: stored.bigMovePct,
      priceTargetEnabled: stored.priceTargetEnabled,
      soundEnabled: stored.soundEnabled,
      quietHoursEnabled: stored.quietHoursEnabled,
      quietStartHour: stored.quietStartHour,
      quietEndHour: stored.quietEndHour,
      source: 'stored',
      updatedAtMs: stored.updatedAt,
    } : { ...DEFAULT_ALERT_RULE_CONFIG, source: 'default', updatedAtMs: null };
    return freeze({
      asOfMs: safeNow(this.#clock),
      profileId,
      unreadCount: countUnreadAlertEvents(profileId, this.#database),
      config,
      priceTargets: listAlertPriceTargets(profileId, this.#database),
      alerts: listVisibleAlertEvents(profileId, limit, this.#database),
    });
  }

  saveConfig(
    profileId: string,
    input: AlertRuleConfigInput,
  ): AlertMutationResult<AlertRuleConfigView> {
    const issues = freeze([...profileIssue(profileId), ...validateConfig(input)]);
    if (issues.length > 0) return freeze({ ok: false, issues });
    const updatedAt = safeNow(this.#clock);
    saveAlertRuleConfig({ profileId, ...input, updatedAt }, this.#database);
    return freeze({ ok: true, value: this.view(profileId).config });
  }

  addPriceTarget(
    profileId: string,
    input: AddAlertPriceTargetInput,
  ): AlertMutationResult<AlertsView['priceTargets'][number]> {
    const issues = [...profileIssue(profileId)];
    if (!exactKeys(input, ['instrument', 'direction', 'priceUsd'])) {
      issues.push(issue([], 'unknown_field'));
    }
    if (!validInstrument(input.instrument)) issues.push(issue(['instrument'], 'invalid_instrument'));
    if (input.direction !== 'above' && input.direction !== 'below') {
      issues.push(issue(['direction'], 'invalid_direction'));
    }
    if (!positiveDecimal(input.priceUsd)) issues.push(issue(['priceUsd'], 'invalid_target_price'));
    if (issues.length > 0) return freeze({ ok: false, issues });
    const id = this.#idSource.nextId();
    if (!UUID_V4.test(id)) {
      return freeze({ ok: false, issues: [issue([], 'invalid_id_source')] });
    }
    const createdAt = safeNow(this.#clock);
    const target = freeze({
      id, profileId, venue: 'coinbase' as const, productId: input.instrument.productId,
      productType: 'spot' as const, direction: input.direction, priceUsd: input.priceUsd,
      enabled: true, createdAt, triggeredAt: null, removedAt: null,
    });
    try {
      insertAlertPriceTarget(target, this.#database);
      return freeze({ ok: true, value: target });
    } catch {
      return freeze({ ok: false, issues: [issue([], 'storage_conflict')] });
    }
  }

  removePriceTarget(profileId: string, id: string): AlertMutationResult<{ removed: true }> {
    const issues = [...profileIssue(profileId)];
    if (!UUID_V4.test(id)) issues.push(issue(['id'], 'invalid_target_id'));
    if (issues.length > 0) return freeze({ ok: false, issues });
    const removed = updateAlertPriceTarget(
      profileId, id, false, safeNow(this.#clock), this.#database,
    );
    return removed
      ? freeze({ ok: true, value: { removed: true as const } })
      : freeze({ ok: false, issues: [issue(['id'], 'target_not_found')] });
  }

  setPriceTargetEnabled(
    profileId: string,
    id: string,
    enabled: boolean,
  ): AlertMutationResult<{ enabled: boolean }> {
    const issues = [...profileIssue(profileId)];
    if (!UUID_V4.test(id)) issues.push(issue(['id'], 'invalid_target_id'));
    if (typeof enabled !== 'boolean') issues.push(issue(['enabled'], 'invalid_boolean'));
    if (issues.length > 0) return freeze({ ok: false, issues });
    const changed = updateAlertPriceTarget(profileId, id, enabled, null, this.#database);
    return changed
      ? freeze({ ok: true, value: { enabled } })
      : freeze({ ok: false, issues: [issue(['id'], 'target_not_found')] });
  }

  record(profileId: string, input: RecordAlertInput): AlertMutationResult<{ created: boolean }> {
    const issues = [...profileIssue(profileId)];
    if (!exactKeys(input, [
      'eventKey', 'kind', 'severity', 'reasonCode', 'evidenceHash', 'instrument', 'occurredAtMs',
    ])) issues.push(issue([], 'unknown_field'));
    if (!EVENT_KEY.test(input.eventKey)) issues.push(issue(['eventKey'], 'invalid_event_key'));
    const kinds: readonly StoredAlertKind[] = [
      'allocation_drift', 'regime_change', 'big_move', 'price_target',
      'policy_event', 'evidence_change',
    ];
    if (!kinds.includes(input.kind)) issues.push(issue(['kind'], 'invalid_kind'));
    if (input.severity !== 'info' && input.severity !== 'warn') {
      issues.push(issue(['severity'], 'invalid_severity'));
    }
    if (!STABLE_CODE.test(input.reasonCode)) issues.push(issue(['reasonCode'], 'invalid_reason_code'));
    if (!HASH.test(input.evidenceHash)) issues.push(issue(['evidenceHash'], 'invalid_evidence_hash'));
    if (input.instrument !== null && !validInstrument(input.instrument)) {
      issues.push(issue(['instrument'], 'invalid_instrument'));
    }
    if (!Number.isSafeInteger(input.occurredAtMs) || input.occurredAtMs < 0) {
      issues.push(issue(['occurredAtMs'], 'invalid_occurred_at'));
    }
    if (issues.length > 0) return freeze({ ok: false, issues });
    const recordedAt = safeNow(this.#clock);
    if (input.occurredAtMs > recordedAt) {
      return freeze({ ok: false, issues: [issue(['occurredAtMs'], 'future_event')] });
    }
    const id = this.#idSource.nextId();
    if (!UUID_V4.test(id)) {
      return freeze({ ok: false, issues: [issue([], 'invalid_id_source')] });
    }
    const event: StoredAlertEvent = freeze({
      id, profileId, eventKey: input.eventKey, kind: input.kind, severity: input.severity,
      reasonCode: input.reasonCode, evidenceHash: input.evidenceHash,
      venue: input.instrument ? 'coinbase' : null, productId: input.instrument?.productId ?? null,
      productType: input.instrument ? 'spot' : null, occurredAt: input.occurredAtMs,
      recordedAt, readAt: null, archivedAt: null,
    });
    try {
      return freeze({ ok: true, value: { created: appendAlertEvent(event, this.#database) } });
    } catch {
      return freeze({ ok: false, issues: [issue([], 'storage_conflict')] });
    }
  }

  markRead(profileId: string): AlertMutationResult<{ marked: number }> {
    const issues = profileIssue(profileId);
    if (issues.length > 0) return freeze({ ok: false, issues });
    return freeze({
      ok: true,
      value: { marked: markVisibleAlertEventsRead(profileId, safeNow(this.#clock), this.#database) },
    });
  }

  archiveVisible(profileId: string): AlertMutationResult<{ archived: number }> {
    const issues = profileIssue(profileId);
    if (issues.length > 0) return freeze({ ok: false, issues });
    return freeze({
      ok: true,
      value: { archived: archiveVisibleAlertEvents(profileId, safeNow(this.#clock), this.#database) },
    });
  }
}
