import { canonicalJson, sha256Hex, type CanonicalJsonValue } from '@coqui/core';

import type { Db } from '../sqlite/index.js';

export interface ParallelPaperExperiment {
  readonly id: string;
  readonly profileId: string;
  readonly sourceConnectionSnapshotId: string;
  readonly alpacaAccountId: string;
  readonly openingCoquiCash: string;
  readonly openingAlpacaCash: string;
  readonly openingAlpacaEquity: string;
  readonly anchor: Readonly<Record<string, string>>;
  readonly startedAt: number;
  readonly configVersion: string;
}

export interface ParallelPaperEvent {
  readonly id: string;
  readonly experimentId: string;
  readonly profileId: string;
  readonly kind: string;
  readonly at: number;
  readonly detail: Record<string, unknown>;
}

export function saveParallelExperiment(value: ParallelPaperExperiment, db: Db): void {
  db.prepare(`INSERT INTO parallel_paper_experiments_v1
    (id,profile_id,source_connection_snapshot_id,alpaca_account_id,opening_coqui_cash,
     opening_alpaca_cash,opening_alpaca_equity,anchor_json,started_at,config_version)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(value.id, value.profileId, value.sourceConnectionSnapshotId,
      value.alpacaAccountId, value.openingCoquiCash, value.openingAlpacaCash,
      value.openingAlpacaEquity, canonicalJson(value.anchor as CanonicalJsonValue),
      value.startedAt, value.configVersion);
}

export function latestParallelExperiment(profileId: string, db: Db): ParallelPaperExperiment | null {
  const row = db.prepare(`SELECT * FROM parallel_paper_experiments_v1
    WHERE profile_id=? ORDER BY started_at DESC,id DESC LIMIT 1`).get(profileId) as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  return {
    id: String(row['id']), profileId: String(row['profile_id']),
    sourceConnectionSnapshotId: String(row['source_connection_snapshot_id']),
    alpacaAccountId: String(row['alpaca_account_id']),
    openingCoquiCash: String(row['opening_coqui_cash']),
    openingAlpacaCash: String(row['opening_alpaca_cash']),
    openingAlpacaEquity: String(row['opening_alpaca_equity']),
    anchor: JSON.parse(String(row['anchor_json'])) as Record<string, string>,
    startedAt: Number(row['started_at']), configVersion: String(row['config_version']),
  };
}

export function appendParallelEvent(input: Omit<ParallelPaperEvent, 'id'> & { readonly key: string }, db: Db): ParallelPaperEvent {
  const id = sha256Hex(`parallel-event:${input.experimentId}:${input.key}`);
  const json = canonicalJson(input.detail as CanonicalJsonValue);
  const old = db.prepare('SELECT kind,detail_json FROM parallel_paper_events_v1 WHERE id=?')
    .get(id) as { kind: string; detail_json: string } | undefined;
  if (old !== undefined) {
    if (old.kind !== input.kind || old.detail_json !== json) throw new Error('Parallel event identity changed.');
  } else {
    db.prepare(`INSERT INTO parallel_paper_events_v1
      (id,experiment_id,profile_id,kind,at,detail_json) VALUES (?,?,?,?,?,?)`).run(
        id, input.experimentId, input.profileId, input.kind, input.at, json);
  }
  return { id, experimentId: input.experimentId, profileId: input.profileId,
    kind: input.kind, at: input.at, detail: input.detail };
}

export function listParallelEvents(experimentId: string, profileId: string, db: Db): readonly ParallelPaperEvent[] {
  return (db.prepare(`SELECT * FROM parallel_paper_events_v1
    WHERE experiment_id=? AND profile_id=? ORDER BY rowid`).all(experimentId, profileId) as Record<string, unknown>[])
    .map((row) => ({ id: String(row['id']), experimentId: String(row['experiment_id']),
      profileId: String(row['profile_id']), kind: String(row['kind']), at: Number(row['at']),
      detail: JSON.parse(String(row['detail_json'])) as Record<string, unknown> }));
}

export function parallelExperimentStatus(events: readonly ParallelPaperEvent[]): 'active' | 'paused' | 'stopped' {
  let status: 'active' | 'paused' | 'stopped' = 'stopped';
  for (const event of events) {
    if (event.kind === 'started' || event.kind === 'resumed') status = 'active';
    if (event.kind === 'paused' || event.kind === 'stopped') status = event.kind;
  }
  return status;
}
