import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { type Clock } from '@coqui/core';
import { createProfileOperationGate, type ProfileOperationGate } from '@coqui/services';
import { migrations, selectNewsReportLocation, verifyIsolatedRestore, type Db } from '@coqui/storage';
import type { ChannelHandlers } from './dispatch.js';
import { readBuildIdentity } from './build-identity.js';

export interface RecoverySelection {
  readonly sourceDatabase: string;
  readonly destinationRoot: string;
}
export interface RecoveryOptions {
  readonly profileId: string;
  readonly operationGate?: ProfileOperationGate;
  readonly pickRecoveryReport?: () => Promise<string | null>;
  readonly pickRecoveryRestore?: () => Promise<RecoverySelection | null>;
}

export function runtimeRecoveryHandlers(options: RecoveryOptions, database: Db, clock: Clock) {
  return createRecoveryHandlers({ profileId: options.profileId, database, clock, buildIdentity: readBuildIdentity()?.sourceHash ?? 'unverified',
    ...(options.operationGate ? { operationGate: options.operationGate } : {}),
    ...(options.pickRecoveryReport ? { pickReport: options.pickRecoveryReport } : {}),
    ...(options.pickRecoveryRestore ? { pickRestore: options.pickRecoveryRestore } : {}) });
}

export function createRecoveryHandlers(input: {
  profileId: string; database: Db; clock: Clock; operationGate?: ProfileOperationGate;
  pickReport?: () => Promise<string | null>;
  pickRestore?: () => Promise<RecoverySelection | null>;
  buildIdentity: string;
}): ChannelHandlers {
  const gate = input.operationGate ?? createProfileOperationGate();
  return {
    'news.report.select-location': async (payload: { reportHash: string }) => {
      if (!input.pickReport) return { ok: false, issues: [{ code: 'recovery_selection_unavailable' }] };
      if (!gate.begin()) return { ok: false, issues: [{ code: 'connection_operation_in_progress' }] };
      try {
        const path = await input.pickReport();
        if (path === null) return { ok: true, value: { status: 'cancelled', reportHash: payload.reportHash } };
        try {
          const value = selectNewsReportLocation({ profileId: input.profileId, reportHash: payload.reportHash,
            path, atMs: input.clock.nowMs() }, input.database);
          return { ok: true, value };
        } catch (error) {
          // Validation happens before insertion; never forward file paths or raw parser errors.
          const code = error instanceof Error && ['report_profile_association_missing', 'report_location_time_conflict',
            'future_report', 'report_integrity_mismatch', 'report_horizons_invalid', 'report_unavailable'].includes(error.message)
            ? error.message : error instanceof Error && ('code' in error || error.name === 'ZodError' || error instanceof SyntaxError)
              ? 'report_artifact_invalid' : 'ambiguous_outcome';
          return { ok: false, issues: [{ code }] };
        }
      } finally { gate.end(); }
    },
    'app.recovery.verify': async (payload: { expectedDatabaseHash: string }) => {
      if (!input.pickRestore) return { ok: false, issues: [{ code: 'recovery_selection_unavailable' }] };
      if (!gate.begin()) return { ok: false, issues: [{ code: 'connection_operation_in_progress' }] };
      try {
        const selected = await input.pickRestore();
        if (!selected) return { ok: true, value: { status: 'cancelled', proof: null } };
        // A copy-only verifier: no runtime, credentials, migrations, or scheduler.
        const db = new DatabaseSync(selected.sourceDatabase, { readOnly: true, allowExtension: false });
        let schema: number;
        try { schema = Number(db.prepare('PRAGMA user_version').get()?.['user_version']); } finally { db.close(); }
        if (schema < 92 || schema > migrations.at(-1)!.version) return { ok: false, issues: [{ code: 'restore_schema_incompatible' }] };
        if (dirname(selected.sourceDatabase) === selected.destinationRoot) return { ok: false, issues: [{ code: 'restore_scope_invalid' }] };
        const proof = verifyIsolatedRestore({ ...selected, destination: join(selected.destinationRoot, `coqui-verification-${randomUUID()}`),
          disposableRoot: selected.destinationRoot, expectedDatabaseHash: payload.expectedDatabaseHash,
          schemaVersion: schema, buildIdentity: input.buildIdentity, artifacts: [] });
        return { ok: true, value: { status: 'verified', proof } };
      } catch {
        return { ok: false, issues: [{ code: 'restore_verification_failed' }] };
      } finally { gate.end(); }
    },
  } as ChannelHandlers;
}
