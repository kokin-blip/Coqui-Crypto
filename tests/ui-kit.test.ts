import { describe, expect, it } from 'vitest';

import {
  alignDecimal,
  formatPercent,
  formatQuantity,
  formatUsd,
  freshnessBadge,
  groupDigits,
  isTerminal,
  presentAction,
  provenanceBadge,
  reduceAction,
  riskBadge,
  signedFigure,
  validationBadge,
  type ActionState,
} from '../packages/ui-kit/src/index.js';

const LABELS = { idle: 'Submit paper order', pending: 'Submitting…' } as const;

describe('financial formatting', () => {
  it('never routes a value through binary float', () => {
    // 0.1 + 0.2 territory: the digits must survive exactly.
    expect(formatQuantity('0.10424000')).toBe('0.10424000');
    expect(alignDecimal('12345.6', 8)).toBe('12345.60000000');
    // Precision beyond the request is kept, never truncated — silently dropping
    // a significant digit from a balance is worse than a wider column.
    expect(alignDecimal('1.123456789', 2)).toBe('1.123456789');
  });

  it('groups the integer part and leaves the fraction alone', () => {
    expect(groupDigits('12481.06')).toBe('12,481.06');
    expect(groupDigits('-12481.06')).toBe('−12,481.06');
    expect(groupDigits('999')).toBe('999');
  });

  it('carries direction by sign and shape, never by color alone', () => {
    const up = signedFigure('661.47');
    expect(up).toMatchObject({ direction: 'up', sign: '+', marker: '▲', label: 'up' });

    const down = signedFigure('-42.10');
    expect(down).toMatchObject({ direction: 'down', sign: '−', marker: '▼', label: 'down' });
    // U+2212 minus, not a hyphen.
    expect(down?.sign).toBe('−');

    const flat = signedFigure('0.00');
    expect(flat).toMatchObject({ direction: 'flat', marker: '–', label: 'unchanged' });
  });

  it('signs a delta but not a balance', () => {
    expect(formatUsd('1204.11', { signed: true })?.text).toBe('+$1,204.11');
    // "+$12,481.06" would imply a change that did not happen.
    expect(formatUsd('12481.06')?.text).toBe('$12,481.06');
    expect(formatUsd('-42.1')?.text).toBe('−$42.10');
  });

  it('always signs a percentage', () => {
    expect(formatPercent(18.44)?.text).toBe('+18.4%');
    expect(formatPercent(-31.65)?.text).toBe('−31.7%');
    expect(formatPercent(0)?.text).toBe('0.0%');
  });

  it('rounds halves symmetrically, so a loss is not nudged toward zero', () => {
    // Math.round rounds halves toward +Infinity, which would give −31.6 here
    // while +31.65 gives +31.7 — optimistic on the loss side.
    expect(formatPercent(31.65)?.text).toBe('+31.7%');
    expect(formatPercent(-31.65)?.text).toBe('−31.7%');
    expect(formatPercent(0.05)?.text).toBe('+0.1%');
    expect(formatPercent(-0.05)?.text).toBe('−0.1%');
    // A magnitude that rounds to zero renders as flat, not as "−0.0%".
    expect(formatPercent(-0.001)?.text).toBe('0.0%');
  });

  it('returns null rather than NaN for anything that is not an exact decimal', () => {
    for (const bad of ['', 'abc', '1e5', '.5', '1.', '01.5', Number.NaN as unknown as string]) {
      expect(signedFigure(bad)).toBeNull();
      expect(formatUsd(bad)).toBeNull();
    }
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('badges', () => {
  it('distinguishes unknown freshness from fresh', () => {
    expect(freshnessBadge('fresh', 120_000)).toMatchObject({ marker: '●', text: '2m ago' });
    expect(freshnessBadge('aging', 3_600_000)).toMatchObject({ marker: '◐', text: '1h ago' });
    expect(freshnessBadge('stale', 172_800_000)).toMatchObject({ marker: '○', text: '2d ago' });

    // A feed that publishes no timestamp is not fresh; saying so would be the
    // false confidence the project exists to avoid.
    const unknown = freshnessBadge('unknown', null);
    expect(unknown.text).toBe('no timestamp');
    expect(unknown.label).toContain('publishes no observation time');
  });

  it('states the direction of the trial bound rather than a bare number', () => {
    const bound = validationBadge('upper-bound', 215);
    expect(bound.text).toBe('upper bound · 215 trials');
    expect(bound.label).toContain('the true count is no larger');

    const unvalidated = validationBadge('unvalidated', null);
    expect(unvalidated.text).toBe('not validated');
    expect(unvalidated.label).toContain('no adopted study');
  });

  it('separates reference provenance from decision data', () => {
    const reference = provenanceBadge({ source: 'api.coingecko.com', informationalOnly: true });
    expect(reference.label).toContain('reference from');

    const decision = provenanceBadge({
      source: 'coinbase',
      datasetHash: '7a3f9c12'.repeat(8),
      informationalOnly: false,
    });
    expect(decision.text).toBe('coinbase · 7a3f9c12…');
    expect(decision.label).toContain('decision data');
  });

  it('labels the risk stage in words as well as digits', () => {
    expect(riskBadge(2)).toEqual({ stage: 2, text: 'stage 2 of 5', label: 'risk stage 2 of 5' });
  });
});

describe('action feedback contract', () => {
  it('has no path from activate to succeeded', () => {
    const pending = reduceAction({ kind: 'idle' }, { type: 'activate' });
    expect(pending.kind).toBe('pending');
    // Optimistic success is forbidden for financial actions: only a settled
    // confirmation may reach 'succeeded'.
    expect(reduceAction(pending, { type: 'activate' }).kind).toBe('pending');
    expect(reduceAction(pending, { type: 'settled', status: 'ok' }).kind).toBe('succeeded');
  });

  it('ignores a duplicate activation while a command is in flight', () => {
    let state: ActionState = { kind: 'idle' };
    state = reduceAction(state, { type: 'activate' });
    const first = state;
    state = reduceAction(state, { type: 'activate' });
    state = reduceAction(state, { type: 'activate' });
    // Same object identity: no second command was produced.
    expect(state).toBe(first);
  });

  it('refuses to settle a state that was never pending', () => {
    expect(reduceAction({ kind: 'idle' }, { type: 'settled', status: 'ok' }).kind).toBe('idle');
    expect(
      reduceAction({ kind: 'succeeded' }, { type: 'settled', status: 'failed' }).kind,
    ).toBe('succeeded');
  });

  it('keeps blocked, failed and unknown distinct', () => {
    const pending: ActionState = { kind: 'pending' };
    expect(reduceAction(pending, { type: 'settled', status: 'blocked', codes: ['position_cap'] }))
      .toEqual({ kind: 'blocked', codes: ['position_cap'] });
    expect(reduceAction(pending, { type: 'settled', status: 'unknown', codes: ['ambiguous_outcome'] }))
      .toEqual({ kind: 'unknown', codes: ['ambiguous_outcome'] });
    expect(reduceAction(pending, { type: 'settled', status: 'failed', codes: ['source_timeout'] }))
      .toEqual({ kind: 'failed', codes: ['source_timeout'] });
    for (const kind of ['blocked', 'unknown', 'failed', 'succeeded'] as const) {
      expect(isTerminal({ kind, codes: [] } as ActionState)).toBe(true);
    }
  });

  it('offers no retry after an unknown outcome', () => {
    const view = presentAction({ kind: 'unknown', codes: ['ambiguous_outcome'] }, LABELS);
    // Invariant 15: recovery queries the venue. A retry button here is exactly
    // how a blind resubmit happens.
    expect(view.disabled).toBe(true);
    expect(view.requiresReconfirmation).toBe(true);
    expect(view.liveMessage).toContain('Do not retry');
  });

  it('disables the control after a guardrail refusal', () => {
    const view = presentAction({ kind: 'blocked', codes: ['turnover_cap'] }, LABELS);
    expect(view.disabled).toBe(true);
    expect(view.liveMessage).toContain('turnover_cap');
  });

  it('requires re-confirmation after a consequential failure but not an ordinary one', () => {
    const failed: ActionState = { kind: 'failed', codes: ['source_timeout'] };
    expect(presentAction(failed, LABELS, 'consequential').requiresReconfirmation).toBe(true);
    expect(presentAction(failed, LABELS, 'ordinary').requiresReconfirmation).toBe(false);
  });

  it('marks the pending state busy and announces it', () => {
    const view = presentAction({ kind: 'pending' }, LABELS);
    expect(view).toMatchObject({ label: 'Submitting…', disabled: true, busy: true });
    expect(view.liveMessage).toContain('Waiting for confirmation');
  });
});
