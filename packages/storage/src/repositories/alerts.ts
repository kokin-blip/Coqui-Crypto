import { inTransaction, type Db } from '../sqlite/index.js';

export interface StoredAlertRuleConfig {
  readonly profileId: string;
  readonly driftEnabled: boolean;
  readonly regimeEnabled: boolean;
  readonly bigMoveEnabled: boolean;
  readonly bigMovePct: string;
  readonly priceTargetEnabled: boolean;
  readonly soundEnabled: boolean;
  readonly quietHoursEnabled: boolean;
  readonly quietStartHour: number;
  readonly quietEndHour: number;
  readonly updatedAt: number;
}

export interface StoredAlertPriceTarget {
  readonly id: string;
  readonly profileId: string;
  readonly venue: 'coinbase';
  readonly productId: string;
  readonly productType: 'spot';
  readonly direction: 'above' | 'below';
  readonly priceUsd: string;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly triggeredAt: number | null;
  readonly removedAt: number | null;
}

export type StoredAlertKind =
  | 'allocation_drift'
  | 'regime_change'
  | 'big_move'
  | 'price_target'
  | 'policy_event'
  | 'evidence_change';

export interface StoredAlertEvent {
  readonly id: string;
  readonly profileId: string;
  readonly eventKey: string;
  readonly kind: StoredAlertKind;
  readonly severity: 'info' | 'warn';
  readonly reasonCode: string;
  readonly evidenceHash: string;
  readonly venue: 'coinbase' | null;
  readonly productId: string | null;
  readonly productType: 'spot' | null;
  readonly occurredAt: number;
  readonly recordedAt: number;
  readonly readAt: number | null;
  readonly archivedAt: number | null;
}

function bool(value: number): boolean {
  return value === 1;
}

export function getAlertRuleConfig(profileId: string, database: Db): StoredAlertRuleConfig | null {
  const row = database.prepare(
    'SELECT * FROM alert_rule_configs_v2 WHERE profile_id = ?',
  ).get(profileId) as Record<string, unknown> | undefined;
  return row ? {
    profileId: row['profile_id'] as string,
    driftEnabled: bool(row['drift_enabled'] as number),
    regimeEnabled: bool(row['regime_enabled'] as number),
    bigMoveEnabled: bool(row['big_move_enabled'] as number),
    bigMovePct: row['big_move_pct_text'] as string,
    priceTargetEnabled: bool(row['price_target_enabled'] as number),
    soundEnabled: bool(row['sound_enabled'] as number),
    quietHoursEnabled: bool(row['quiet_hours_enabled'] as number),
    quietStartHour: row['quiet_start_hour'] as number,
    quietEndHour: row['quiet_end_hour'] as number,
    updatedAt: row['updated_at'] as number,
  } : null;
}

export function saveAlertRuleConfig(config: StoredAlertRuleConfig, database: Db): void {
  database.prepare(`
    INSERT INTO alert_rule_configs_v2 (
      profile_id, drift_enabled, regime_enabled, big_move_enabled, big_move_pct_text,
      price_target_enabled, sound_enabled, quiet_hours_enabled, quiet_start_hour,
      quiet_end_hour, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      drift_enabled = excluded.drift_enabled,
      regime_enabled = excluded.regime_enabled,
      big_move_enabled = excluded.big_move_enabled,
      big_move_pct_text = excluded.big_move_pct_text,
      price_target_enabled = excluded.price_target_enabled,
      sound_enabled = excluded.sound_enabled,
      quiet_hours_enabled = excluded.quiet_hours_enabled,
      quiet_start_hour = excluded.quiet_start_hour,
      quiet_end_hour = excluded.quiet_end_hour,
      updated_at = excluded.updated_at
  `).run(
    config.profileId, config.driftEnabled ? 1 : 0, config.regimeEnabled ? 1 : 0,
    config.bigMoveEnabled ? 1 : 0, config.bigMovePct, config.priceTargetEnabled ? 1 : 0,
    config.soundEnabled ? 1 : 0, config.quietHoursEnabled ? 1 : 0,
    config.quietStartHour, config.quietEndHour, config.updatedAt,
  );
}

function targetFromRow(row: Record<string, unknown>): StoredAlertPriceTarget {
  return {
    id: row['id'] as string,
    profileId: row['profile_id'] as string,
    venue: 'coinbase',
    productId: row['product_id'] as string,
    productType: 'spot',
    direction: row['direction'] as StoredAlertPriceTarget['direction'],
    priceUsd: row['price_usd_text'] as string,
    enabled: bool(row['enabled'] as number),
    createdAt: row['created_at'] as number,
    triggeredAt: row['triggered_at'] as number | null,
    removedAt: row['removed_at'] as number | null,
  };
}

export function insertAlertPriceTarget(target: StoredAlertPriceTarget, database: Db): void {
  database.prepare(`
    INSERT INTO alert_price_targets_v2 (
      id, profile_id, venue, product_id, product_type, direction, price_usd_text,
      enabled, created_at, triggered_at, removed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    target.id, target.profileId, target.venue, target.productId, target.productType,
    target.direction, target.priceUsd, target.enabled ? 1 : 0, target.createdAt,
    target.triggeredAt, target.removedAt,
  );
}

export function listAlertPriceTargets(profileId: string, database: Db): StoredAlertPriceTarget[] {
  const rows = database.prepare(`
    SELECT * FROM alert_price_targets_v2
    WHERE profile_id = ? AND removed_at IS NULL
    ORDER BY created_at DESC, id
  `).all(profileId) as unknown as Array<Record<string, unknown>>;
  return rows.map(targetFromRow);
}

export function updateAlertPriceTarget(
  profileId: string,
  id: string,
  enabled: boolean,
  removedAt: number | null,
  database: Db,
): boolean {
  const result = database.prepare(`
    UPDATE alert_price_targets_v2
    SET enabled = ?, triggered_at = CASE WHEN ? = 1 THEN NULL ELSE triggered_at END,
        removed_at = COALESCE(removed_at, ?)
    WHERE profile_id = ? AND id = ? AND removed_at IS NULL
  `).run(enabled ? 1 : 0, enabled ? 1 : 0, removedAt, profileId, id);
  return Number(result.changes) === 1;
}

function eventFromRow(row: Record<string, unknown>): StoredAlertEvent {
  return {
    id: row['id'] as string,
    profileId: row['profile_id'] as string,
    eventKey: row['event_key'] as string,
    kind: row['kind'] as StoredAlertKind,
    severity: row['severity'] as StoredAlertEvent['severity'],
    reasonCode: row['reason_code'] as string,
    evidenceHash: row['evidence_hash'] as string,
    venue: row['venue'] as 'coinbase' | null,
    productId: row['product_id'] as string | null,
    productType: row['product_type'] as 'spot' | null,
    occurredAt: row['occurred_at'] as number,
    recordedAt: row['recorded_at'] as number,
    readAt: row['read_at'] as number | null,
    archivedAt: row['archived_at'] as number | null,
  };
}

export function appendAlertEvent(event: StoredAlertEvent, database: Db): boolean {
  return inTransaction(database, () => {
    const prior = database.prepare(`
      SELECT * FROM alert_events_v2 WHERE profile_id = ? AND event_key = ?
    `).get(event.profileId, event.eventKey) as Record<string, unknown> | undefined;
    if (prior) {
      const same = prior['kind'] === event.kind && prior['severity'] === event.severity &&
        prior['reason_code'] === event.reasonCode && prior['evidence_hash'] === event.evidenceHash &&
        prior['venue'] === event.venue && prior['product_id'] === event.productId &&
        prior['product_type'] === event.productType && prior['occurred_at'] === event.occurredAt;
      if (!same) throw new Error('Alert event identity cannot change.');
      return false;
    }
    database.prepare(`
      INSERT INTO alert_events_v2 (
        id, profile_id, event_key, kind, severity, reason_code, evidence_hash,
        venue, product_id, product_type, occurred_at, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id, event.profileId, event.eventKey, event.kind, event.severity,
      event.reasonCode, event.evidenceHash, event.venue, event.productId,
      event.productType, event.occurredAt, event.recordedAt,
    );
    database.prepare(`
      INSERT INTO alert_event_visibility_v2 (event_id, profile_id, read_at, archived_at)
      VALUES (?, ?, NULL, NULL)
    `).run(event.id, event.profileId);
    return true;
  });
}

export function listVisibleAlertEvents(
  profileId: string,
  limit: number,
  database: Db,
): StoredAlertEvent[] {
  const rows = database.prepare(`
    SELECT e.*, v.read_at, v.archived_at
    FROM alert_events_v2 e
    JOIN alert_event_visibility_v2 v ON v.event_id = e.id
    WHERE e.profile_id = ? AND v.profile_id = ? AND v.archived_at IS NULL
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT ?
  `).all(profileId, profileId, limit) as unknown as Array<Record<string, unknown>>;
  return rows.map(eventFromRow);
}

export function countUnreadAlertEvents(profileId: string, database: Db): number {
  const row = database.prepare(`
    SELECT COUNT(*) AS count FROM alert_event_visibility_v2
    WHERE profile_id = ? AND archived_at IS NULL AND read_at IS NULL
  `).get(profileId) as { count: number };
  return row.count;
}

export function markVisibleAlertEventsRead(profileId: string, at: number, database: Db): number {
  const result = database.prepare(`
    UPDATE alert_event_visibility_v2 SET read_at = ?
    WHERE profile_id = ? AND archived_at IS NULL AND read_at IS NULL
      AND event_id IN (
        SELECT id FROM alert_events_v2 WHERE profile_id = ? AND recorded_at <= ?
      )
  `).run(at, profileId, profileId, at);
  return Number(result.changes);
}

export function archiveVisibleAlertEvents(profileId: string, at: number, database: Db): number {
  const result = database.prepare(`
    UPDATE alert_event_visibility_v2 SET archived_at = ?, read_at = COALESCE(read_at, ?)
    WHERE profile_id = ? AND archived_at IS NULL
      AND event_id IN (
        SELECT id FROM alert_events_v2 WHERE profile_id = ? AND recorded_at <= ?
      )
  `).run(at, at, profileId, profileId, at);
  return Number(result.changes);
}
