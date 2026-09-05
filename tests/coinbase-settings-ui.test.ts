import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  actionFailureCopy,
  COINBASE_REASON_COPY,
  coinbaseIssueCopy,
} from '../apps/desktop/src/renderer/app/coinbase-presentation.js';

const read = (path: string): string => readFileSync(resolve(path), 'utf8');

describe('Coinbase settings presentation', () => {
  it('has recovery copy for every connection reason without exposing diagnostics', () => {
    expect(Object.keys(COINBASE_REASON_COPY).sort()).toEqual([
      'credential_invalid', 'credential_missing', 'identity_mismatch',
      'manifest_identity_missing', 'portfolio_identity_missing', 'secret_store_unavailable',
    ]);
    for (const copy of Object.values(COINBASE_REASON_COPY)) {
      expect(copy.length).toBeGreaterThan(24);
      expect(copy).not.toMatch(/private.?key|bearer|authorization/iu);
    }
  });

  it('distinguishes failed, blocked, and unknown command outcomes', () => {
    expect(actionFailureCopy({ kind: 'failed', codes: ['authentication_failed'] }))
      .toContain('Coinbase rejected');
    expect(actionFailureCopy({ kind: 'blocked', codes: ['profile_operation_in_progress'] }))
      .toMatch(/^Blocked\./u);
    expect(actionFailureCopy({ kind: 'unknown', codes: ['unexpected_failure'] }))
      .toContain('Do not retry yet');
    expect(actionFailureCopy({ kind: 'succeeded' })).toBeNull();
  });

  it('explains excessive permission and sync failures with stable safe copy', () => {
    expect(coinbaseIssueCopy('coinbase_verification_excess_permissions'))
      .toBe('This key can trade or transfer. Create a view-only key instead.');
    expect(coinbaseIssueCopy('elapsed_budget_exhausted')).toContain('five-minute');
    expect(coinbaseIssueCopy('unknown_future_code')).toContain('unknown future code');
  });

  it('provides explicit copy for every service connection and sync issue', () => {
    for (const [file, start, end] of [
      ['coinbase-connection.ts', 'export type CoinbaseConnectionIssueCode =', 'export interface CoinbaseConnectionIssue'],
      ['coinbase-sync.ts', 'export type CoinbaseSyncFailureCode =', 'export interface CoinbaseSyncView'],
    ] as const) {
      const source = read(`packages/services/src/accounts/${file}`);
      const union = source.slice(source.indexOf(start), source.indexOf(end));
      for (const match of union.matchAll(/'([a-z_]+)'/gu)) {
        expect(coinbaseIssueCopy(match[1] ?? '')).not.toMatch(/^Coinbase operation failed/u);
      }
    }
  });

  it('isolates profile action state and reads credential text only during submission', () => {
    const component = read('apps/desktop/src/renderer/app/CoinbaseConnectionSettings.tsx');
    expect(component).toContain('useState<File | null>');
    expect(component).not.toContain('readonly contents: string');
    expect(component).toContain('if (active.current) onConnect(contents)');
    expect(component).toContain('readingRef.current');
    expect(read('apps/desktop/src/renderer/app/Settings.tsx')).toContain('key={view.profileId}');
    expect(component).toContain('Sync outcome unknown');
    expect(component).toContain('disconnectTrigger.current?.focus()');
  });

  it('keeps key contents ephemeral and uses only the view-only channel surface', () => {
    const component = read('apps/desktop/src/renderer/app/CoinbaseConnectionSettings.tsx');
    expect(component).toContain('type="file"');
    expect(component).toContain("'accounts.coinbase.connect-json'");
    expect(component).toContain("'accounts.coinbase.sync'");
    expect(component).toContain("'accounts.coinbase.disconnect'");
    expect(component).toContain('setSelected(null)');
    expect(component).not.toMatch(/console\.|localStorage|sessionStorage/gu);
    expect(component).not.toContain('accounts.coinbase.connect\'');
  });
});

describe('desktop typography and shared polish contract', () => {
  it('self-hosts IBM Plex Sans and removes Manrope from renderer sources', () => {
    const desktopPackage = read('apps/desktop/package.json');
    const base = read('apps/desktop/src/renderer/styles/base.css');
    const workstation = read('apps/desktop/src/renderer/styles/workstation.css');
    expect(desktopPackage).toContain('"@fontsource-variable/ibm-plex-sans": "5.3.0"');
    expect(desktopPackage).not.toContain('@fontsource-variable/manrope');
    expect(base).toContain("@fontsource-variable/ibm-plex-sans/wght.css");
    expect(base).toContain("'IBM Plex Sans Variable'");
    expect(`${base}\n${workstation}`).not.toMatch(/Manrope/gu);
  });

  it('defines reusable surface states and semantic advisory tokens', () => {
    const primitives = read('apps/desktop/src/renderer/styles/primitives.css');
    const theme = read('packages/ui-kit/src/theme.css');
    const workstation = read('apps/desktop/src/renderer/styles/workstation.css');
    expect(primitives).toContain('.surface-state-error');
    expect(primitives).toContain('.surface-state-blocked');
    expect(theme).toContain('--coqui-advisory-soft');
    expect(workstation).toContain('var(--coqui-advisory-surface)');
    for (const file of ['base', 'primitives', 'features', 'shell', 'workstation']) {
      const css = read(`apps/desktop/src/renderer/styles/${file}.css`);
      for (const match of css.matchAll(/font-weight:\s*(\d+)/gu)) {
        expect(Number(match[1])).toBeLessThanOrEqual(700);
      }
    }
  });
});
