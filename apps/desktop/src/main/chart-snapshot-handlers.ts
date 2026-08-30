import { sha256Hex, type Clock } from '@coqui/core';
import type { Db } from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';

interface Options {
  readonly profileId: string;
  readonly database: Db;
  readonly clock: Clock;
  readonly save?: (filenameStem: string, png: Uint8Array) => Promise<'saved' | 'cancelled'>;
}

/** Validate, deduplicate, and delegate PNG persistence without exposing a path. */
export function createChartSnapshotHandlers(options: Options): ChannelHandlers {
  return { 'app.chart.snapshot.save': async (payload: {
    readonly commandId: string;
    readonly filenameStem: string;
    readonly pngBase64: string;
  }) => {
    const requestHash = sha256Hex(`${options.profileId}:${payload.filenameStem}:${payload.pngBase64}`);
    const prior = options.database.prepare('SELECT profile_id, request_hash, outcome FROM chart_snapshot_commands_v1 WHERE command_id = ?').get(payload.commandId) as { profile_id: string; request_hash: string; outcome: 'saved' | 'cancelled' } | undefined;
    if (prior !== undefined) return prior.profile_id === options.profileId && prior.request_hash === requestHash
      ? { ok: true, value: { outcome: prior.outcome } }
      : { ok: false, issues: [{ code: 'command_conflict' }] };
    const png = Buffer.from(payload.pngBase64, 'base64');
    if (png.length === 0 || png.length > 8 * 1024 * 1024 ||
      png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      return { ok: false, issues: [{ code: 'invalid_png' }] };
    }
    const outcome = options.save === undefined ? 'cancelled' : await options.save(payload.filenameStem, png);
    options.database.prepare('INSERT INTO chart_snapshot_commands_v1 (command_id, profile_id, request_hash, outcome, recorded_at_ms) VALUES (?, ?, ?, ?, ?)').run(payload.commandId, options.profileId, requestHash, outcome, options.clock.nowMs());
    return { ok: true, value: { outcome } };
  } } as ChannelHandlers;
}
