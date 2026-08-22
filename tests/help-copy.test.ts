import { describe, expect, it } from 'vitest';

import { helpEntry, HELP } from '../packages/ui-kit/src/index.js';

describe('help copy', () => {
  it('says nothing that contradicts the hard invariants', () => {
    const corpus = Object.values(HELP)
      .map((entry) => `${entry.title} ${entry.body}`)
      .join(' ')
      .toLowerCase();

    // Invariant 12: the predecessor's on-chain-import copy promised lots that
    // "start at $0 cost". That describes fabricating a cost basis.
    expect(corpus).not.toContain('$0 cost');
    expect(corpus).not.toContain('zero-basis');

    // Invariants 4 and 10: the predecessor's paperBacktest entry advertised
    // "ignores fees, slippage, and taxes".
    expect(corpus).not.toContain('ignores fees');
    expect(corpus).not.toMatch(/ignores? (fees|slippage|costs)/u);

    // Product naming.
    expect(corpus).not.toContain('kokincrypto');
  });

  it('never describes live trading as available', () => {
    const corpus = Object.values(HELP).map((entry) => entry.body).join(' ');
    // Every mention of live must be a denial or a condition, never a capability.
    for (const entry of Object.values(HELP)) {
      if (!/live/iu.test(entry.body)) continue;
      expect(entry.body).toMatch(/not enable|no order-submission|does not place|cannot/iu);
    }
    expect(corpus).not.toMatch(/place (a )?real (order|trade)s? (now|today)/iu);
  });

  it('documents the surfaces that actually exist', () => {
    for (const key of [
      'estimateOnly',
      'pricedSubtotal',
      'reconciliationException',
      'trialUpperBound',
      'notValidated',
      'negativeFindings',
      'evidenceGate',
      'freshness',
    ]) {
      expect(helpEntry(key), `missing help for ${key}`).not.toBeNull();
    }
  });

  it('drops the entries for rejected or unbuilt surfaces', () => {
    // Dropped rather than stubbed: UI-UX §0 forbids filler standing in for an
    // explanation, and help for a surface that does not exist is worse.
    for (const key of [
      'socialConsensus',
      'recommendAutoApply',
      'playback',
      'botTab',
      'suggestMix',
      'watchlist',
      'wallet',
      'paperBacktest',
    ]) {
      expect(helpEntry(key), `${key} should not have been ported`).toBeNull();
    }
  });

  it('states the evidence gate Coqui actually enforces', () => {
    const gate = helpEntry('evidenceGate');
    expect(gate).not.toBeNull();
    // The predecessor's copy quoted 365 tradeable days, which is not our bar.
    expect(gate?.body).not.toContain('365');
    expect(gate?.body).toContain('90 observed days');
    expect(gate?.body).toContain('50 decisions');
    expect(gate?.body).toContain('30 fills');
  });

  it('returns null for an unknown key rather than a prototype member', () => {
    expect(helpEntry('nope')).toBeNull();
    expect(helpEntry('toString')).toBeNull();
    expect(helpEntry('__proto__')).toBeNull();
  });

  it('is frozen and non-empty throughout', () => {
    expect(Object.isFrozen(HELP)).toBe(true);
    for (const [key, entry] of Object.entries(HELP)) {
      expect(key).toMatch(/^[a-z][A-Za-z]*$/u);
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.body.length).toBeGreaterThan(30);
    }
  });
});
