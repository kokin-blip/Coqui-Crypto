import { generateKeyPairSync } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { createMemorySecretStore } from '@coqui/adapters';
import { coinbaseEvidenceDatasetHash, FixedClock } from '@coqui/core';
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
      coinbaseAcquirer: { acquire: async () => {
        control.acquisitions += 1;
        await delay(80);
        return control.failSync ? { ok: false, code: 'network' } : {
          ok: true,
          value: {
            accounts: [], fills: [], transactions: [], feeTier: null,
            accountPageCount: 1, fillPageCount: 1, transactionPageCount: 0,
            datasetHash: coinbaseEvidenceDatasetHash([], []),
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
  await waitFor('Boolean(document.querySelector(".coinbase-key-control"))');
  check('Coinbase disconnected Settings renders', true);
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const contents = JSON.stringify({ name: 'organizations/smoke/apiKeys/view-only', privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const selectFile = async () => {
    await evaluate(`(() => {
      const input = document.querySelector('.coinbase-settings input[type=file]');
      const transfer = new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(contents)}], 'smoke-key.json', {type:'application/json'}));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await waitFor('document.querySelector(".coinbase-filename")?.textContent === "smoke-key.json"');
  };
  await selectFile();
  check('Coinbase selection renders filename without credential contents', await evaluate('!document.body.innerText.includes("PRIVATE KEY") && !document.body.innerText.includes("organizations/smoke")'));
  await click('Verify and connect', true);
  await waitFor('document.body.innerText.includes("This key can trade or transfer")');
  check('Coinbase excessive permissions rejected and duplicate activation suppressed', fixture.control.verifications === 1);
  fixture.control.rejectKey = false;
  await selectFile();
  await click('Verify and connect', true);
  await waitFor('Boolean(document.querySelector(".connection-connected"))');
  check('Coinbase replacement file connects through renderer IPC', fixture.control.verifications === 2);
  await click('Sync immutable evidence', true);
  await waitFor('document.body.innerText.includes("Coinbase is temporarily unavailable")');
  check('Coinbase sync failure renders and duplicate activation suppressed', fixture.control.acquisitions === 1);
  fixture.control.failSync = false;
  await click('Sync immutable evidence', true);
  await waitFor('Boolean(document.querySelector(".coinbase-sync-result"))');
  check('Coinbase sync success confirms immutable evidence', fixture.control.acquisitions === 2 && await evaluate('document.body.innerText.includes("Portfolio history, tax lots, and execution state were not changed.")'));
  const switchProfile = async (id) => {
    await evaluate(`(() => {
      const select = document.querySelector('select[aria-label="Active profile"]');
      select.value = ${JSON.stringify(id)};
      select.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
  };
  await switchProfile('00000000-0000-4000-8000-000000000001');
  await waitFor('Boolean(document.querySelector(".connection-disconnected"))');
  check('Coinbase profile switch clears prior evidence and success feedback', await evaluate('!document.querySelector(".coinbase-sync-result") && !document.body.innerText.includes("Coinbase connected")'));
  await switchProfile('main');
  await waitFor('Boolean(document.querySelector(".connection-connected"))');
  check('Coinbase original profile retains isolated connection', true);
  await click('Disconnect');
  await waitFor('Boolean(document.querySelector(".coinbase-disconnect-dialog[open]"))');
  await click('Cancel');
  await waitFor('!document.querySelector(".coinbase-disconnect-dialog[open]")');
  await waitFor('document.activeElement?.classList.contains("button-disconnect")');
  check('Coinbase disconnect cancellation restores focus', await evaluate('document.activeElement?.classList.contains("button-disconnect")'));
  await click('Disconnect');
  await click('Remove credential');
  await waitFor('Boolean(document.querySelector(".connection-disconnected"))');
  check('Coinbase confirmed disconnect clears stale sync and connection feedback', await evaluate('!document.querySelector(".coinbase-sync-result") && !document.body.innerText.includes("Coinbase connected")'));
  const settings = await evaluate('window.coqui.query("accounts.settings", {}).then(JSON.stringify)');
  const status = await evaluate('window.coqui.query("accounts.coinbase.status", {}).then(JSON.stringify)');
  check('Coinbase credential absent from preferences and command readback', !`${settings}${status}`.includes('PRIVATE KEY') && !`${settings}${status}`.includes('organizations/smoke'));
}
