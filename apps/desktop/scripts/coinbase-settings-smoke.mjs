import { generateKeyPairSync } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { createMemorySecretStore } from '@coqui/adapters';
import { coinbaseEvidenceDatasetHash, decimal, FixedClock } from '@coqui/core';
import { AccountsProfileService } from '@coqui/services';
import { createFileProfileManifestStore, openDatabase } from '@coqui/storage';

export async function seedCoinbaseSmokeProfile(directory) {
  const profiles = new AccountsProfileService({
    clock: new FixedClock(Date.now()),
    idSource: { nextId: () => '00000000-0000-4000-8000-000000000001' },
    manifestStore: createFileProfileManifestStore(join(directory, 'wallet-profiles.json')),
    databaseProvisioner: { provision: async (_id, filename) => {
      openDatabase(join(directory, filename)).close();
      return { ok: true };
    } },
  });
  profiles.initializeMain('coqui.db');
  if (!(await profiles.create({ name: 'Smoke isolated profile' })).ok) throw new Error('Could not seed isolated smoke profile.');
}

/** Offline fixtures only. Never read an owner's credential or reach Coinbase. */
export function coinbaseSmokeFixture() {
  const control = { rejectKey: true, failSync: true, verifications: 0, acquisitions: 0 };
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const contents = JSON.stringify({ name: 'organizations/smoke/apiKeys/view-only', privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  return {
    control,
    coinbaseVerifier: { verify: async () => {
      control.verifications += 1;
      await delay(80);
      return control.rejectKey
        ? { ok: false, reasonCode: 'excess_permissions' }
        : { ok: true, portfolioUuid: '22222222-2222-4222-8222-222222222222' };
    } },
    runtime: {
      secrets: createMemorySecretStore(),
      pickConnectionFile: async () => ({ contents }),
      coinbaseAcquirer: { acquire: async () => {
        control.acquisitions += 1;
        await delay(80);
        return control.failSync ? { ok: false, code: 'network' } : {
          ok: true,
          value: {
            accounts: [{ accountUuid: '33333333-3333-4333-8333-333333333333', currency: 'USD',
              availableQuantity: decimal('250'), holdQuantity: decimal('0'), totalQuantity: decimal('250'),
              active: true, ready: true, defaultAccount: true, providerUpdatedAtMs: Date.now() }],
            fills: [], transactions: [], feeTier: null,
            accountPageCount: 1, fillPageCount: 1, transactionPageCount: 0,
            datasetHash: coinbaseEvidenceDatasetHash([{ accountUuid: '33333333-3333-4333-8333-333333333333', currency: 'USD',
              availableQuantity: decimal('250'), holdQuantity: decimal('0'), totalQuantity: decimal('250'),
              active: true, ready: true, defaultAccount: true, providerUpdatedAtMs: null }], []),
          },
        };
      } },
    },
  };
}

export async function checkCoinbaseSettings(window, fixture, check) {
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error('Coinbase Settings smoke state did not settle.');
  };
  const click = (label, twice = false) => evaluate(`(() => {
    const button = [...document.querySelectorAll('.coinbase-settings button')].find(b => b.textContent.includes(${JSON.stringify(label)}));
    if (!button) throw new Error('Expected Coinbase control missing');
    button.click(); ${twice ? 'button.click();' : ''}
  })()`);
  await evaluate('window.location.hash = "/settings"');
  await waitFor('document.body.innerText.includes("Exchange connections")');
  check('Provider-neutral Settings renders', true);
  check('Credential contents stay outside renderer', await evaluate('!document.body.innerText.includes("PRIVATE KEY") && !document.body.innerText.includes("organizations/smoke")'));
  await click('Choose Coinbase key file', true);
  await waitFor('document.body.innerText.includes("coinbase_excess_permissions")');
  check('Coinbase excessive permissions rejected and duplicate activation suppressed', fixture.control.verifications === 1);
  fixture.control.rejectKey = false;
  fixture.control.failSync = false;
  await click('Choose Coinbase key file', true);
  await waitFor('document.body.innerText.includes("Portfolio updated") || document.body.innerText.includes("Connection added")');
  check('Coinbase file connects and creates current portfolio evidence', fixture.control.verifications === 2 && fixture.control.acquisitions === 1);
  const current = JSON.parse(await evaluate('window.coqui.query("portfolio.current", {}).then(JSON.stringify)'));
  check('portfolio.current is backed by connected accounts', current.status === 'ok' && current.value?.source === 'connected_accounts');
  await evaluate('window.location.hash = "/overview"');
  await waitFor('document.body.innerText.includes("Connected portfolio") && document.body.innerText.includes("$250.00")');
  check('Overview renders connected balances without tax lots', true);
  await evaluate('window.location.hash = "/settings"');
  await waitFor('document.body.innerText.includes("Exchange connections")');
  await click('Sync now', true);
  for (let attempt = 0; attempt < 100 && fixture.control.acquisitions < 2; attempt += 1) await delay(50);
  check('Coinbase sync command is idempotently activated', fixture.control.acquisitions === 2);
  const switchProfile = async (id) => {
    await evaluate(`(() => {
      const select = document.querySelector('select[aria-label="Active profile"]');
      select.value = ${JSON.stringify(id)};
      select.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
  };
  await switchProfile('00000000-0000-4000-8000-000000000001');
  await waitFor('document.body.innerText.includes("No exchange connections yet")');
  check('Coinbase profile switch clears prior connection evidence', true);
  await switchProfile('main');
  await waitFor('document.body.innerText.includes("Sync now")');
  check('Coinbase original profile retains isolated connection', true);
  await click('Disconnect');
  await waitFor('window.coqui.query("connections.list", {}).then(result => result.status === "ok" && result.value.connections[0]?.status === "disconnected")');
  check('Coinbase disconnect is connection scoped', true);
  const settings = await evaluate('window.coqui.query("accounts.settings", {}).then(JSON.stringify)');
  const status = await evaluate('window.coqui.query("connections.list", {}).then(JSON.stringify)');
  check('Coinbase credential absent from preferences and command readback', !`${settings}${status}`.includes('PRIVATE KEY') && !`${settings}${status}`.includes('organizations/smoke'));
}
