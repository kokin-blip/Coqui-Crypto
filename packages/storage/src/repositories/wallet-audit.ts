import { inTransaction, type Db } from '../sqlite/index.js';

export interface StoredWalletSafetyStop {
  readonly profileId: string;
  readonly active: boolean;
  readonly kind: string;
  readonly reason: string;
  readonly triggeredAt: number;
  readonly acknowledgedAt: number | null;
  readonly acknowledgementReason: string | null;
  readonly updatedAt: number;
}

export interface StoredWalletSafetyStopEvent {
  readonly id: string;
  readonly profileId: string;
  readonly action: 'activated' | 'acknowledged';
  readonly kind: string;
  readonly reason: string;
  readonly at: number;
  readonly runId: string | null;
}

export interface StoredWalletRunAudit {
  readonly id: string;
  readonly profileId: string;
  readonly runId: string;
  readonly at: number;
  readonly kind: string;
  readonly status: string;
  readonly detailJson: string;
}

export interface RuntimeIncident {
  readonly id: string;
  readonly profileId: string;
  readonly runId: string | null;
  readonly kind:
    | 'stale_data'
    | 'sequence_gap'
    | 'reconciliation'
    | 'scheduler_failure'
    | 'risk_stop'
    | 'execution_fault'
    | 'provider_invalid'
    | 'worker_failure';
  readonly severity: 'warning' | 'blocking' | 'critical';
  readonly source: string;
  readonly detailJson: string;
  readonly occurredAt: number;
  readonly resolvedAt: number | null;
  readonly resolution: string | null;
}

function assertJson(value: string): void {
  try {
    JSON.parse(value);
  } catch {
    throw new TypeError('Audit detail must be valid JSON.');
  }
}

export function getWalletSafetyStop(
  profileId: string,
  database: Db,
): StoredWalletSafetyStop | null {
  const row = database.prepare(
    'SELECT * FROM wallet_safety_stop_state WHERE profile_id = ?',
  ).get(profileId) as {
    profile_id: string;
    active: number;
    kind: string;
    reason: string;
    triggered_at: number;
    acknowledged_at: number | null;
    acknowledgement_reason: string | null;
    updated_at: number;
  } | undefined;
  return row ? {
    profileId: row.profile_id,
    active: row.active === 1,
    kind: row.kind,
    reason: row.reason,
    triggeredAt: row.triggered_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgementReason: row.acknowledgement_reason,
    updatedAt: row.updated_at,
  } : null;
}

export function listWalletSafetyStopEvents(
  profileId: string,
  limit: number,
  database: Db,
): StoredWalletSafetyStopEvent[] {
  const rows = database.prepare(`
    SELECT * FROM wallet_safety_stop_events
    WHERE profile_id = ? ORDER BY at DESC, id DESC LIMIT ?
  `).all(profileId, Math.max(1, Math.min(500, Math.floor(limit)))) as unknown as Array<{
    id: string;
    profile_id: string;
    action: StoredWalletSafetyStopEvent['action'];
    kind: string;
    reason: string;
    at: number;
    run_id: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    action: row.action,
    kind: row.kind,
    reason: row.reason,
    at: row.at,
    runId: row.run_id,
  }));
}

export function activateWalletSafetyStop(
  stop: {
    readonly eventId: string;
    readonly profileId: string;
    readonly kind: string;
    readonly reason: string;
    readonly at: number;
    readonly runId?: string | null;
  },
  database: Db,
): StoredWalletSafetyStop {
  const reason = stop.reason.trim();
  if (!reason) throw new Error('A safety-stop reason is required.');
  const priorEvent = database.prepare(
    'SELECT profile_id, action, kind, reason, at, run_id FROM wallet_safety_stop_events WHERE id = ?',
  ).get(stop.eventId) as unknown as {
    profile_id: string; action: string; kind: string; reason: string; at: number; run_id: string | null;
  } | undefined;
  if (priorEvent) {
    const same = priorEvent.profile_id === stop.profileId && priorEvent.action === 'activated'
      && priorEvent.kind === stop.kind && priorEvent.reason === reason && priorEvent.at === stop.at
      && priorEvent.run_id === (stop.runId ?? null);
    if (!same) throw new Error('A safety-stop event identity cannot change after persistence.');
    return getWalletSafetyStop(stop.profileId, database)!;
  }
  inTransaction(database, () => {
    database.prepare(`
      INSERT INTO wallet_safety_stop_state (
        profile_id, active, kind, reason, triggered_at, acknowledged_at,
        acknowledgement_reason, updated_at
      ) VALUES (?, 1, ?, ?, ?, NULL, NULL, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        active = 1,
        kind = excluded.kind,
        reason = excluded.reason,
        triggered_at = CASE
          WHEN wallet_safety_stop_state.active = 1
            THEN wallet_safety_stop_state.triggered_at
          ELSE excluded.triggered_at
        END,
        acknowledged_at = NULL,
        acknowledgement_reason = NULL,
        updated_at = excluded.updated_at
    `).run(stop.profileId, stop.kind, reason, stop.at, stop.at);
    database.prepare(`
      INSERT INTO wallet_safety_stop_events
        (id, profile_id, action, kind, reason, at, run_id)
      VALUES (?, ?, 'activated', ?, ?, ?, ?)
    `).run(stop.eventId, stop.profileId, stop.kind, reason, stop.at, stop.runId ?? null);
  });
  return getWalletSafetyStop(stop.profileId, database)!;
}

export function acknowledgeWalletSafetyStop(
  acknowledgement: {
    readonly eventId: string;
    readonly profileId: string;
    readonly reason: string;
    readonly at: number;
  },
  database: Db,
): StoredWalletSafetyStop {
  const reason = acknowledgement.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new Error('A safety-stop acknowledgement reason between 3 and 500 characters is required.');
  }
  const current = getWalletSafetyStop(acknowledgement.profileId, database);
  if (!current?.active) throw new Error('There is no active safety stop to acknowledge.');
  inTransaction(database, () => {
    const changed = database.prepare(`
      UPDATE wallet_safety_stop_state
      SET active = 0, acknowledged_at = ?, acknowledgement_reason = ?, updated_at = ?
      WHERE profile_id = ? AND active = 1
    `).run(
      acknowledgement.at,
      reason,
      acknowledgement.at,
      acknowledgement.profileId,
    );
    if (Number(changed.changes) !== 1) {
      throw new Error('The safety stop changed before it could be acknowledged.');
    }
    database.prepare(`
      INSERT INTO wallet_safety_stop_events
        (id, profile_id, action, kind, reason, at, run_id)
      VALUES (?, ?, 'acknowledged', ?, ?, ?, NULL)
    `).run(
      acknowledgement.eventId,
      acknowledgement.profileId,
      current.kind,
      reason,
      acknowledgement.at,
    );
  });
  return getWalletSafetyStop(acknowledgement.profileId, database)!;
}

/** Append one immutable wallet execution audit. */
export function appendWalletRunAudit(audit: StoredWalletRunAudit, database: Db): boolean {
  assertJson(audit.detailJson);
  const prior = database.prepare(
    'SELECT profile_id, run_id, at, kind, status, detail_json FROM wallet_execution_journal WHERE id = ?',
  ).get(audit.id) as unknown as {
    profile_id: string; run_id: string; at: number; kind: string; status: string; detail_json: string;
  } | undefined;
  if (prior) {
    const same = prior.profile_id === audit.profileId && prior.run_id === audit.runId
      && prior.at === audit.at && prior.kind === audit.kind && prior.status === audit.status
      && prior.detail_json === audit.detailJson;
    if (!same) throw new Error('A wallet audit identity cannot change after persistence.');
    return false;
  }
  const result = database.prepare(`
    INSERT INTO wallet_execution_journal
      (id, profile_id, run_id, at, kind, status, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    audit.id,
    audit.profileId,
    audit.runId,
    audit.at,
    audit.kind,
    audit.status,
    audit.detailJson,
  );
  return Number(result.changes) === 1;
}

export function listWalletRunAudits(
  profileId: string,
  limit: number,
  database: Db,
): StoredWalletRunAudit[] {
  const rows = database.prepare(`
    SELECT * FROM wallet_execution_journal
    WHERE profile_id = ? ORDER BY at DESC, id DESC LIMIT ?
  `).all(profileId, Math.max(1, Math.min(500, Math.floor(limit)))) as unknown as Array<{
    id: string;
    profile_id: string;
    run_id: string;
    at: number;
    kind: string;
    status: string;
    detail_json: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    runId: row.run_id,
    at: row.at,
    kind: row.kind,
    status: row.status,
    detailJson: row.detail_json,
  }));
}

/** Append one immutable incident. Resolutions are represented by later incidents. */
/**
 * One run's journal in the order it happened.
 *
 * The `(run_id, at)` index exists for exactly this. `listWalletRunAudits`
 * filters by profile and orders newest-first, which suits a dashboard but not a
 * replay of a single run.
 */
export function listWalletRunAuditsByRun(
  runId: string,
  limit: number,
  database: Db,
): StoredWalletRunAudit[] {
  const bounded = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = database.prepare(`
    SELECT * FROM wallet_execution_journal
    WHERE run_id = ? ORDER BY at, id LIMIT ?
  `).all(runId, bounded) as unknown as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row['id']),
    profileId: String(row['profile_id']),
    runId: String(row['run_id']),
    at: Number(row['at']),
    kind: String(row['kind']),
    status: String(row['status']),
    detailJson: String(row['detail_json']),
  }));
}

export function appendRuntimeIncident(incident: RuntimeIncident, database: Db): boolean {
  assertJson(incident.detailJson);
  const prior = database.prepare('SELECT * FROM runtime_incidents WHERE id = ?').get(incident.id) as
    Record<string, unknown> | undefined;
  if (prior) {
    const same = prior['profile_id'] === incident.profileId && prior['run_id'] === incident.runId
      && prior['kind'] === incident.kind && prior['severity'] === incident.severity
      && prior['source'] === incident.source && prior['detail_json'] === incident.detailJson
      && prior['occurred_at'] === incident.occurredAt && prior['resolved_at'] === incident.resolvedAt
      && prior['resolution'] === incident.resolution;
    if (!same) throw new Error('A runtime incident identity cannot change after persistence.');
    return false;
  }
  const result = database.prepare(`
    INSERT INTO runtime_incidents (
      id, profile_id, run_id, kind, severity, source, detail_json,
      occurred_at, resolved_at, resolution
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    incident.id,
    incident.profileId,
    incident.runId,
    incident.kind,
    incident.severity,
    incident.source,
    incident.detailJson,
    incident.occurredAt,
    incident.resolvedAt,
    incident.resolution,
  );
  return Number(result.changes) === 1;
}

export function listRuntimeIncidents(
  profileId: string,
  unresolvedOnly: boolean,
  limit: number,
  database: Db,
): RuntimeIncident[] {
  const rows = database.prepare(`
    SELECT * FROM runtime_incidents
    WHERE profile_id = ? AND (? = 0 OR resolved_at IS NULL)
    ORDER BY occurred_at DESC, id DESC LIMIT ?
  `).all(
    profileId,
    unresolvedOnly ? 1 : 0,
    Math.max(1, Math.min(500, Math.floor(limit))),
  ) as unknown as Array<{
    id: string;
    profile_id: string;
    run_id: string | null;
    kind: RuntimeIncident['kind'];
    severity: RuntimeIncident['severity'];
    source: string;
    detail_json: string;
    occurred_at: number;
    resolved_at: number | null;
    resolution: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    runId: row.run_id,
    kind: row.kind,
    severity: row.severity,
    source: row.source,
    detailJson: row.detail_json,
    occurredAt: row.occurred_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  }));
}
