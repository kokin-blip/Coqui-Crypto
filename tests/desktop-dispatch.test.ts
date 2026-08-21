import { describe, expect, it, vi } from 'vitest';

import {
  createDispatcher,
  type ChannelHandlers,
} from '../apps/desktop/src/main/dispatch.js';
import { CHANNEL_NAMES, type ChannelName } from '../packages/contracts/src/index.js';

const RUN = {
  id: 'trendvol-replacement-v1',
  preRegistrationHash: 'a'.repeat(64),
  datasetHash: 'b'.repeat(64),
  costProfileHash: 'c'.repeat(64),
  codeRevision: '037927e',
  selectedCandidateId: 'e'.repeat(64),
  adopted: false,
  completedAtMs: 1_723_000_000_000,
  runHash: 'f'.repeat(64),
};

function handlers(overrides: Partial<Record<ChannelName, unknown>> = {}): ChannelHandlers {
  const base = Object.fromEntries(
    CHANNEL_NAMES.map((name) => [name, () => ({ ok: false, issues: [{ path: [name], code: 'not_implemented' }] })]),
  ) as Record<ChannelName, unknown>;
  return { ...base, ...overrides } as ChannelHandlers;
}

describe('dispatcher channel gate', () => {
  it('refuses a channel that is not in the registry', async () => {
    const dispatch = createDispatcher({ handlers: handlers() });
    expect(await dispatch('market-data.everything', {})).toEqual({
      status: 'failed',
      issues: [{ path: ['transport'], code: 'unknown_channel' }],
    });
    expect(await dispatch('__proto__', {})).toEqual({
      status: 'failed',
      issues: [{ path: ['transport'], code: 'unknown_channel' }],
    });
    expect(await dispatch(null, {})).toEqual({
      status: 'failed',
      issues: [{ path: ['transport'], code: 'unknown_channel' }],
    });
  });

  it('never invokes a handler for an invalid payload', async () => {
    const jobs = vi.fn(() => ({ ok: true, value: [] }));
    const dispatch = createDispatcher({ handlers: handlers({ 'research.jobs': jobs }) });

    expect(await dispatch('research.jobs', { limit: 5000 })).toEqual({
      status: 'failed',
      issues: [{ path: ['transport'], code: 'invalid_request_payload' }],
    });
    expect(await dispatch('research.jobs', { limit: 10, extra: 'x' })).toEqual({
      status: 'failed',
      issues: [{ path: ['transport'], code: 'invalid_request_payload' }],
    });
    expect(jobs).not.toHaveBeenCalled();
  });

  it('passes a validated payload through and returns an ok outcome', async () => {
    const dispatch = createDispatcher({
      handlers: handlers({ 'research.runs': () => ({ ok: true, value: [RUN] }) }),
    });
    expect(await dispatch('research.runs', {})).toEqual({ status: 'ok', value: [RUN] });
  });
});

describe('dispatcher outcome classification', () => {
  it('reports a guardrail refusal as blocked, not failed', async () => {
    const dispatch = createDispatcher({
      handlers: handlers({
        'research.runs': () => ({
          ok: false,
          issues: [{ path: ['runs'], code: 'kill_switch_engaged' }],
        }),
      }),
    });
    const outcome = await dispatch('research.runs', {});
    expect(outcome.status).toBe('blocked');
  });

  it('reports an indeterminate outcome as unknown, never as success or failure', async () => {
    const dispatch = createDispatcher({
      handlers: handlers({
        'market-data.trending': () => ({
          ok: false,
          issues: [{ path: ['trending'], code: 'source_shutdown' }],
        }),
      }),
    });
    const outcome = await dispatch('market-data.trending', {});
    expect(outcome.status).toBe('unknown');
  });

  it('reports an ordinary service issue as failed and preserves its code', async () => {
    const dispatch = createDispatcher({
      handlers: handlers({
        'market-data.yields': () => ({
          ok: false,
          issues: [{ path: ['yields'], code: 'source_rate_limited' }],
        }),
      }),
    });
    expect(await dispatch('market-data.yields', {})).toEqual({
      status: 'failed',
      issues: [{ path: ['yields'], code: 'source_rate_limited' }],
    });
  });
});

describe('dispatcher response validation', () => {
  it('refuses a response that does not satisfy the contract', async () => {
    const onUnexpectedError = vi.fn();
    const dispatch = createDispatcher({
      handlers: handlers({
        'research.runs': () => ({ ok: true, value: [{ ...RUN, runHash: 'too-short' }] }),
      }),
      onUnexpectedError,
    });

    expect(await dispatch('research.runs', {})).toEqual({
      status: 'failed',
      issues: [{ path: ['transport'], code: 'invalid_response_payload' }],
    });
    expect(onUnexpectedError).toHaveBeenCalledOnce();
  });

  it('strips an unexpected property instead of letting it reach the renderer', async () => {
    const dispatch = createDispatcher({
      handlers: handlers({
        'research.runs': () => ({ ok: true, value: [{ ...RUN, internalPath: '/Users/x/db' }] }),
      }),
    });
    // The response schema is strict, so a smuggled field fails the whole reply
    // rather than travelling with it.
    expect(await dispatch('research.runs', {})).toEqual({
      status: 'failed',
      issues: [{ path: ['transport'], code: 'invalid_response_payload' }],
    });
  });
});

describe('dispatcher error containment', () => {
  it('turns a thrown error into a stable code and leaks no message', async () => {
    const onUnexpectedError = vi.fn();
    const secret = 'ENOENT /Users/someone/.coqui/profile.db';
    const dispatch = createDispatcher({
      handlers: handlers({
        'research.runs': () => {
          throw new Error(secret);
        },
      }),
      onUnexpectedError,
    });

    const outcome = await dispatch('research.runs', {});
    expect(outcome).toEqual({
      status: 'failed',
      issues: [{ path: ['transport'], code: 'transport_unavailable' }],
    });
    expect(JSON.stringify(outcome)).not.toContain('ENOENT');
    expect(JSON.stringify(outcome)).not.toContain('/Users/');

    // The detail still reaches the log, where it is useful and local.
    expect(onUnexpectedError).toHaveBeenCalledOnce();
    expect((onUnexpectedError.mock.calls[0]?.[1] as Error).message).toBe(secret);
  });

  it('contains a rejected promise the same way', async () => {
    const dispatch = createDispatcher({
      handlers: handlers({
        'research.runs': async () => {
          throw new Error('async boom');
        },
      }),
    });
    expect((await dispatch('research.runs', {})).status).toBe('failed');
  });

  it('survives a handler returning something that is not a result', async () => {
    const dispatch = createDispatcher({
      handlers: handlers({ 'research.runs': () => undefined as never }),
    });
    expect((await dispatch('research.runs', {})).status).toBe('failed');
  });
});

describe('dispatcher coverage', () => {
  it('requires a handler for every registered channel', () => {
    const complete = handlers();
    for (const name of CHANNEL_NAMES) {
      expect(complete[name]).toBeTypeOf('function');
    }
  });
});
