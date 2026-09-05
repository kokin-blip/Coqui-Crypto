import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemorySecretStore } from '../packages/adapters/src/index.js';
import { coinbaseEvidenceDatasetHash } from '../packages/core/src/index.js';
import { afterEach, describe, expect, it } from 'vitest';

import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
import { createRuntimeProfileController } from '../apps/desktop/src/main/profile-runtime.js';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const SYNC_COMMAND_ID = '33333333-3333-4333-8333-333333333333';
const DISCONNECT_COMMAND_ID = '44444444-4444-4444-8444-444444444444';
const PORTFOLIO_ID = '22222222-2222-4222-8222-222222222222';
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (directory) =>
    await rm(directory, { recursive: true, force: true })));
});

describe('Coinbase desktop runtime wiring', () => {
  it('connects, reports status, synchronizes evidence, and disconnects through IPC contracts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'coqui-coinbase-runtime-'));
    directories.push(directory);
    const secrets = createMemorySecretStore();
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const controller = createRuntimeProfileController({
      dataDirectory: directory,
      legacyDatabaseFilename: 'coqui.db',
      disableScheduler: true,
      coinbaseVerifier: {
        verify: async () => ({ ok: true, portfolioUuid: PORTFOLIO_ID }),
      },
      runtime: {
        readSystemTime: () => 100,
        secrets,
        coinbaseAcquirer: {
          acquire: async () => ({
            ok: true,
            value: {
              accounts: [],
              fills: [],
              transactions: [],
              feeTier: null,
              accountPageCount: 1,
              fillPageCount: 1,
              transactionPageCount: 0,
              datasetHash: coinbaseEvidenceDatasetHash([], []),
            },
          }),
        },
      },
    });
    const dispatch = createDispatcher({ handlers: () => controller.handlers() });

    await expect(dispatch('accounts.coinbase.status', {})).resolves.toMatchObject({
      status: 'ok', value: { state: 'disconnected', readOnly: true },
    });
    await expect(dispatch('accounts.coinbase.connect', {
      commandId: COMMAND_ID,
      keyName: 'organizations/test/apiKeys/read-only',
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    })).resolves.toMatchObject({
      status: 'ok', value: { state: 'connected', executionAuthority: false },
    });
    await expect(dispatch('accounts.coinbase.sync', { commandId: SYNC_COMMAND_ID }))
      .resolves.toMatchObject({
        status: 'ok',
        value: { accountCount: 0, fillCount: 0, portfolioMutated: false },
      });
    await expect(dispatch('accounts.coinbase.disconnect', { commandId: DISCONNECT_COMMAND_ID }))
      .resolves.toMatchObject({ status: 'ok', value: { state: 'disconnected' } });

    controller.dispose();
  });
});
