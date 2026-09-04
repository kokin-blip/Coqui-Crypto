import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FixedClock } from '../packages/core/src/index.js';
import { ChartExtensionService } from '../packages/services/src/index.js';
import { openDatabase } from '../packages/storage/src/index.js';

const T0 = 1_800_000_000_000;
const WASM = Buffer.from('0061736d0100000001070160027c7f017c03020100070d01097472616e73666f726d00000a0601040020000b', 'hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function fixture() {
  const database = openDatabase(':memory:');
  const service = new ChartExtensionService({ profileId: 'main', database, clock: new FixedClock(T0) });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const signerKeyId = service.trustSigner('Owner test key', publicKeyBase64);
  const unsigned = { format: 'coqui-chart-extension-v1' as const,
    manifest: { id: 'coqui.identity', name: 'Identity line', version: '1.0.0', compatibility: '0.1.x', author: 'Coqui tests', license: 'MIT', series: { id: 'identity', title: 'Identity', pane: 0, color: '#8b7cff' } },
    payload: { wasmBase64: WASM.toString('base64'), sha256: createHash('sha256').update(WASM).digest('hex') } };
  const packageJson = JSON.stringify({ ...unsigned, signature: { signerKeyId,
    signatureBase64: sign(null, Buffer.from(canonical(unsigned)), privateKey).toString('base64') } });
  return { database, service, packageJson, signerKeyId };
}

describe('signed chart extensions', () => {
  it('installs disabled after verifying an owner-approved Ed25519 signer', () => {
    const value = fixture();
    expect(value.service.install(value.packageJson)).toEqual({ outcome: 'installed', extensionId: 'coqui.identity' });
    expect(value.service.catalog().extensions[0]).toMatchObject({ id: 'coqui.identity', enabled: false, signerKeyId: value.signerKeyId });
    value.database.close();
  });

  it('rejects tampering and undeclared executable fields', () => {
    const value = fixture();
    const tampered = value.packageJson.replace('Identity line', 'Altered line');
    expect(() => value.service.install(tampered)).toThrow('invalid_signature');
    const parsed = JSON.parse(value.packageJson) as Record<string, unknown>;
    expect(() => value.service.install(JSON.stringify({ ...parsed, javascript: 'fetch("https://example.com")' }))).toThrow('invalid_package');
    value.database.close();
  });

  it('disables packages when their only trusted signer is removed', () => {
    const value = fixture();
    value.service.install(value.packageJson);
    value.service.set('coqui.identity', true, {});
    expect(value.service.revokeSigner(value.signerKeyId)).toBe(1);
    expect(value.service.catalog().extensions[0]?.enabled).toBe(false);
    value.database.close();
  });

  it('evaluates enabled import-free WebAssembly into declarative display series', async () => {
    const value = fixture();
    value.service.install(value.packageJson);
    value.service.set('coqui.identity', true, {});
    await expect(value.service.evaluate('coqui.identity', [
      { timeMs: 1_000, close: '100.125' },
      { timeMs: 2_000, close: '101.5' },
    ])).resolves.toEqual({
      series: [{
        id: 'identity', title: 'Identity', pane: 0, color: '#8b7cff',
        points: [{ timeMs: 1_000, value: '100.125' }, { timeMs: 2_000, value: '101.5' }],
      }],
      markers: [], informationalOnly: true, decisionEligible: false,
    });
    value.database.close();
  });

  it('keeps extension lifecycle evidence append-only', () => {
    const value = fixture();
    value.service.install(value.packageJson);
    expect(() => value.database.prepare('DELETE FROM chart_extension_events_v1').run()).toThrow(/immutable/u);
    value.database.close();
  });
});
