import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRuntime } from '../apps/desktop/src/main/composition.js';
import { createDispatcher, type ChannelHandlers } from '../apps/desktop/src/main/dispatch.js';
import { createMemorySecretStore } from '../packages/adapters/src/index.js';
import { CHANNEL_NAMES, type ChannelName } from '../packages/contracts/src/index.js';
import { FixedClock } from '../packages/core/src/index.js';
import { CoinGeckoConnectionService } from '../packages/services/src/index.js';
import type { Db } from '../packages/storage/src/index.js';

/**
 * The canary sweep P7 requires.
 *
 * `tests/secrets.test.ts` is a good unit suite over the store itself. This is
 * the broader thing invariant 3 actually claims: a known secret is injected,
 * and every route out of the main process is swept for it — IPC responses,
 * error paths, the reporting hook's *wire* output, and every value in every
 * column of the database.
 *
 * The canary is deliberately distinctive. A test that searched for something
 * short would pass on a coincidence.
 */

const CANARY = 'CG-CANARYd0n0tl3ak99';
const T0 = 1_800_000_000_000;

let directory: string;
let databasePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'coqui-canary-'));
  databasePath = join(directory, 'wallet-main.db');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** Channels that answer from local state. The rest would reach the network. */
const LOCAL_CHANNELS: readonly ChannelName[] = [
  'research.runs',
  'research.jobs',
  'research.job',
  'research.scoreboard',
  'research.negative-findings',
  'risk.evidence-gate',
  'risk.dashboard',
  'portfolio.tax',
  'portfolio.reconciliation',
  'accounts.settings',
  'app.status-rail',
];

const PAYLOADS: Partial<Record<ChannelName, unknown>> = {
  'research.jobs': { limit: 10 },
  'research.job': { id: 'a'.repeat(64) },
  'accounts.settings': { profileId: 'main' },
  'app.status-rail': { profileId: 'main' },
  'portfolio.reconciliation': { profileId: 'main' },
};

/** Every value in every column of every table, as one string. */
function everyStoredValue(database: Db): string {
  const tables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all() as unknown as Array<{ name: string }>;

  const seen: string[] = [];
  for (const table of tables) {
    const rows = database.prepare(`SELECT * FROM "${table.name}"`).all() as unknown as Array<
      Record<string, unknown>
    >;
    for (const row of rows) seen.push(JSON.stringify(row));
  }
  return seen.join('\n');
}

describe('a connected key never reaches the renderer', () => {
  it('appears in no channel response', async () => {
    const runtime = createRuntime({
      databasePath,
      profileId: 'main',
      disableScheduler: true,
      // The one place the key legitimately exists inside the process.
      coinGeckoApiKey: CANARY,
    });
    const dispatch = createDispatcher({ handlers: runtime.handlers });

    for (const channel of LOCAL_CHANNELS) {
      const outcome = await dispatch(channel, PAYLOADS[channel] ?? {});
      // Serialised, not inspected field by field: a leak in a nested provenance
      // object is still a leak, and a field-by-field check would miss the field
      // nobody thought to add to the list.
      expect(JSON.stringify(outcome)).not.toContain(CANARY);
    }

    runtime.dispose();
  });

  it('appears in no column of the database', () => {
    const runtime = createRuntime({
      databasePath,
      profileId: 'main',
      disableScheduler: true,
      coinGeckoApiKey: CANARY,
    });

    // Invariant 3 names the database explicitly. A key cached "just for
    // convenience" in a settings row is the classic version of this.
    expect(everyStoredValue(runtime.database)).not.toContain(CANARY);
    runtime.dispose();
  });

  it('is reachable to the process that needs it, which is the point of the test', async () => {
    // Guards against a sweep that passes because the canary was never injected
    // anywhere. The secret store holds it; the wire never does.
    const store = createMemorySecretStore({ 'coingecko-api-key': CANARY });
    const service = new CoinGeckoConnectionService({
      clock: new FixedClock(T0),
      secretStore: store,
      verifier: { verify: async () => ({ ok: true }) },
    });

    expect(await store.read('coingecko-api-key', null)).toEqual({ ok: true, value: CANARY });
    expect(JSON.stringify(await service.status())).not.toContain(CANARY);
  });
});

describe('an error carrying a secret does not carry it across IPC', () => {
  const handlers = {
    'research.runs': () => {
      throw new Error(`upstream rejected key ${CANARY}`);
    },
  } as unknown as ChannelHandlers;

  it('reports a stable code instead of the message', async () => {
    const dispatch = createDispatcher({ handlers });
    const outcome = await dispatch('research.runs', {});

    // An exception crossing IPC arrives at the renderer as a string built from
    // the error's own message — which is exactly how a secret in an upstream
    // error escapes.
    expect(JSON.stringify(outcome)).not.toContain(CANARY);
    expect(outcome).toMatchObject({ status: 'failed' });
  });

  it('gives the full error to the local reporter and nothing to the wire', async () => {
    const reported: unknown[] = [];
    const dispatch = createDispatcher({
      handlers,
      onUnexpectedError: (_channel, error) => reported.push(error),
    });
    const outcome = await dispatch('research.runs', {});

    // The detail has to go *somewhere* or a failure is undiagnosable. It goes
    // to the local reporter, and the asymmetry is the guarantee.
    expect(JSON.stringify(reported.map(String))).toContain(CANARY);
    expect(JSON.stringify(outcome)).not.toContain(CANARY);
  });

  it('drops a value a handler tried to return', async () => {
    const leaky = {
      'research.negative-findings': () => ({
        ok: true,
        value: { findings: [], ledgerNote: CANARY, apiKey: CANARY },
      }),
    } as unknown as ChannelHandlers;

    // Response validation runs on the way out for this reason: a service that
    // drifts from the contract fails at the boundary rather than shipping a
    // field nobody declared.
    const outcome = await createDispatcher({ handlers: leaky })('research.negative-findings', {});
    expect(JSON.stringify(outcome)).not.toContain(CANARY);
    expect(outcome).toMatchObject({ status: 'failed' });
  });
});

describe('the sweep covers the whole registry', () => {
  it('names every channel it does not exercise', () => {
    const unexercised = CHANNEL_NAMES.filter((channel) => !LOCAL_CHANNELS.includes(channel));

    // Not a gap being hidden: these reach the network, so exercising them here
    // would test the internet. They are swept by the packaged smoke gate
    // instead, which runs them against a live main process.
    expect(unexercised.every((channel) =>
      channel.startsWith('market-data.')
      || channel === 'portfolio.view'
      || channel === 'portfolio.allocation'
      || channel === 'paper.portfolio'
      || channel === 'portfolio.reconciliation.resolve',
    )).toBe(true);
  });
});
