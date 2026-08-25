import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(import.meta.dirname, '..', 'scripts', 'verify-coinbase-view-only.mjs'),
  'utf8',
);

describe('the real Coinbase verification harness', () => {
  it('accepts credentials only through an external key-file environment variable', () => {
    expect(source).toContain("process.env['COQUI_COINBASE_KEY_FILE']");
    expect(source).not.toContain('process.argv');
    expect(source).toContain('outsideRepository(keyFile)');
  });

  it('uses the production connection and permission boundaries', () => {
    expect(source).toContain('CoinbaseConnectionService');
    expect(source).toContain('probeCoinbaseViewOnlyPermissions');
    expect(source).toContain('createOsKeyringSecretStore');
    expect(source).toContain("service.disconnect(profileId)");
  });

  it('prints only the closed sanitized evidence object', () => {
    expect(source.match(/console\.log/g)?.length).toBe(
      source.match(/console\.log\(JSON\.stringify/g)?.length,
    );
    expect(source).not.toMatch(/console\.(?:log|error)\([^\n]*(?:keyFile|contents|parsed|profileId)/u);
    expect(source).toContain("? 'verified'");
    expect(source).not.toContain('portfolioUuid:');
    expect(source).not.toContain('fingerprint:');
  });
});
