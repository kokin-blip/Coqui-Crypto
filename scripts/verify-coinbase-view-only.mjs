import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  createCoinbaseReadHttpClient,
  createOsKeyringSecretStore,
  parseCoinbaseKeyFileJson,
  probeCoinbaseViewOnlyPermissions,
} from '../packages/adapters/dist/index.js';
import { SystemClock } from '../packages/core/dist/index.js';
import {
  CoinbaseConnectionService,
  createProfileOperationGate,
} from '../packages/services/dist/index.js';
import { createFileProfileManifestStore } from '../packages/storage/dist/index.js';

const MAX_KEY_FILE_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/iu;

function statusClass(status) {
  return Number.isSafeInteger(status) && status > 0 ? Math.floor(status / 100) + 'xx' : null;
}

function outsideRepository(path) {
  const repository = resolve(process.cwd());
  const candidate = resolve(path);
  const relation = relative(repository, candidate);
  return isAbsolute(relation) || relation === '..' || relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
}

function sanitizedFailure(code) {
  return {
    ok: false,
    codeRevision: process.env['COQUI_CODE_REVISION'] ?? 'working-tree',
    verifiedAt: new Date().toISOString(),
    permissionHttpStatusClass: null,
    accountsHttpStatusClass: null,
    permissions: null,
    outcomeCode: code,
    cleanup: 'not_required',
  };
}

async function main() {
  const keyFile = process.env['COQUI_COINBASE_KEY_FILE'];
  if (!keyFile || !outsideRepository(keyFile)) {
    console.log(JSON.stringify(sanitizedFailure('key_file_must_be_outside_repository')));
    process.exitCode = 2;
    return;
  }

  let contents;
  try {
    contents = await readFile(keyFile, { encoding: 'utf8' });
  } catch {
    console.log(JSON.stringify(sanitizedFailure('key_file_unreadable')));
    process.exitCode = 2;
    return;
  }
  if (Buffer.byteLength(contents, 'utf8') > MAX_KEY_FILE_BYTES) {
    console.log(JSON.stringify(sanitizedFailure('key_file_too_large')));
    process.exitCode = 2;
    return;
  }
  const parsed = parseCoinbaseKeyFileJson(contents);
  if (!parsed.ok) {
    console.log(JSON.stringify(sanitizedFailure('invalid_coinbase_key_file')));
    process.exitCode = 2;
    return;
  }

  const profileId = randomUUID();
  const root = await mkdtemp(join(tmpdir(), 'coqui-view-only-verification-'));
  const manifestStore = createFileProfileManifestStore(join(root, 'wallet-profiles.json'));
  const createdAt = Date.now();
  const initialized = manifestStore.replace(null, {
    version: 1,
    activeProfileId: profileId,
    profiles: [{
      id: profileId,
      name: 'Coinbase verification',
      color: '#60a5fa',
      icon: 'shield',
      dbFilename: `wallet-${profileId}.db`,
      createdAt,
      lastOpenedAt: createdAt,
      order: 0,
    }],
  });
  if (!initialized.ok) throw new Error('ephemeral_manifest_unavailable');

  const secretStore = createOsKeyringSecretStore();
  let diagnostics = { permissionHttpStatus: null, accountsHttpStatus: null };
  const verifier = {
    async verify(credentials, signal) {
      const client = createCoinbaseReadHttpClient(credentials);
      try {
        const result = await probeCoinbaseViewOnlyPermissions(client, signal);
        diagnostics = result.diagnostics;
        if (!result.ok) return { ok: false, reasonCode: result.code };
        const portfolioUuid = result.portfolioUuid?.trim().toLowerCase() ?? '';
        return UUID.test(portfolioUuid)
          ? { ok: true, portfolioUuid }
          : { ok: false, reasonCode: 'invalid_portfolio_identity' };
      } catch {
        return { ok: false, reasonCode: 'unexpected_failure' };
      } finally {
        client.destroy();
      }
    },
  };
  const service = new CoinbaseConnectionService({
    clock: new SystemClock(() => Date.now()),
    manifestStore,
    secretStore,
    verifier,
    operationGate: createProfileOperationGate(),
  });

  let outcomeCode = 'coinbase_verification_failed';
  let connected;
  let cleanup;
  try {
    const result = await service.connect(profileId, parsed.credentials);
    connected = result.ok && result.value.state === 'connected';
    outcomeCode = result.ok ? 'view_only_verified' : result.issues[0]?.code ?? outcomeCode;
    if (connected) {
      const status = await service.status(profileId);
      connected = status.ok && status.value.state === 'connected' &&
        status.value.permissionMode === 'view_only' && status.value.readOnly === true &&
        status.value.executionAuthority === false && status.value.transferAuthority === false &&
        status.value.receiveAuthority === false;
      if (!connected) outcomeCode = 'connected_status_inconsistent';
    }
    if (connected) await service.disconnect(profileId);
  } finally {
    const removed = await secretStore.remove('coinbase-credentials', profileId);
    const absent = await secretStore.read('coinbase-credentials', profileId);
    const manifest = manifestStore.read();
    const profile = manifest.ok
      ? manifest.value?.manifest.profiles.find((item) => item.id === profileId)
      : null;
    cleanup = removed.ok && absent.ok && absent.value === null && profile !== null &&
      profile !== undefined && profile.coinbaseKeyFingerprint === undefined &&
      profile.coinbasePortfolioFingerprint === undefined
      ? 'verified'
      : 'failed';
    await rm(root, { recursive: true, force: true });
  }

  const ok = connected && cleanup === 'verified';
  console.log(JSON.stringify({
    ok,
    codeRevision: process.env['COQUI_CODE_REVISION'] ?? 'working-tree',
    verifiedAt: new Date().toISOString(),
    permissionHttpStatusClass: statusClass(diagnostics.permissionHttpStatus),
    accountsHttpStatusClass: statusClass(diagnostics.accountsHttpStatus),
    permissions: connected
      ? { view: true, trade: false, transfer: false, receive: false }
      : null,
    outcomeCode,
    cleanup,
  }));
  if (!ok) process.exitCode = 1;
}

main().catch(() => {
  console.log(JSON.stringify(sanitizedFailure('verification_harness_failed')));
  process.exitCode = 1;
});
