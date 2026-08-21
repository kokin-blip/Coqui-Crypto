import { describe, expect, it } from 'vitest';

import {
  CHANNEL_KINDS,
  CHANNEL_NAMES,
  CHANNEL_SCHEMAS,
  isChannelName,
  issueSchema,
  outcomeStatusSchema,
  requestEnvelopeSchema,
  responseEnvelopeSchema,
  transportFailure,
  TRANSPORT_ISSUE_CODES,
  type ChannelName,
} from '../packages/contracts/src/index.js';

const REQUEST_ID = '3f8a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const CORRELATION_ID = '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';

function requestFor(channel: ChannelName, payload: unknown): unknown {
  return {
    schemaVersion: 1,
    kind: 'request',
    type: channel,
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    issuedAtMs: 1_724_000_000_000,
    payload,
  };
}

describe('channel registry', () => {
  it('exposes every channel as a dotted lowercase name with both directions typed', () => {
    expect(CHANNEL_NAMES.length).toBeGreaterThan(0);
    for (const name of CHANNEL_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);
      const schemas = CHANNEL_SCHEMAS[name];
      expect(typeof schemas.request.safeParse).toBe('function');
      expect(typeof schemas.response.safeParse).toBe('function');
    }
  });

  it('matches the boundaries that actually have tested services today', () => {
    expect([...CHANNEL_NAMES].sort()).toEqual([
      'market-data.candles',
      'market-data.fear-greed',
      'market-data.markets',
      'market-data.news',
      'market-data.prices',
      'market-data.trending',
      'market-data.yields',
      'research.job',
      'research.jobs',
      'research.runs',
      'risk.evidence-gate',
    ]);
  });

  it('refuses a channel name that is not registered', () => {
    expect(isChannelName('market-data.prices')).toBe(true);
    expect(isChannelName('market-data.everything')).toBe(false);
    expect(isChannelName('__proto__')).toBe(false);
    expect(isChannelName(null)).toBe(false);
  });

  it('classifies every channel, and declares no write channel before P6', () => {
    expect([...CHANNEL_KINDS.read].sort()).toEqual([...CHANNEL_NAMES].sort());
    expect(CHANNEL_KINDS.write).toEqual([]);
  });
});

describe('request validation', () => {
  it('rejects an unexpected property rather than forwarding it', () => {
    const schema = requestEnvelopeSchema(CHANNEL_SCHEMAS['research.jobs'].request);
    expect(schema.safeParse(requestFor('research.jobs', { limit: 10 })).success).toBe(true);
    expect(
      schema.safeParse(requestFor('research.jobs', { limit: 10, extra: 'x' })).success,
    ).toBe(false);
  });

  it('enforces payload bounds at the boundary, before any service runs', () => {
    const jobs = CHANNEL_SCHEMAS['research.jobs'].request;
    expect(jobs.safeParse({ limit: 200 }).success).toBe(true);
    expect(jobs.safeParse({ limit: 201 }).success).toBe(false);
    expect(jobs.safeParse({ limit: 0 }).success).toBe(false);
    expect(jobs.safeParse({ limit: 1.5 }).success).toBe(false);

    const candles = CHANNEL_SCHEMAS['market-data.candles'].request;
    const instrument = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' };
    expect(candles.safeParse({ instrument, lookbackDays: 30 }).success).toBe(true);
    expect(candles.safeParse({ instrument, lookbackDays: 1826 }).success).toBe(false);
    expect(
      candles.safeParse({
        instrument: { ...instrument, productId: 'not a product' },
        lookbackDays: 30,
      }).success,
    ).toBe(false);
  });

  it('rejects a traversal-shaped job id before it reaches storage', () => {
    const job = CHANNEL_SCHEMAS['research.job'].request;
    expect(job.safeParse({ id: 'job-1' }).success).toBe(true);
    expect(job.safeParse({ id: '../../etc/passwd' }).success).toBe(false);
    expect(job.safeParse({ id: '' }).success).toBe(false);
  });
});

describe('response envelope', () => {
  const schema = responseEnvelopeSchema(CHANNEL_SCHEMAS['research.runs'].response);

  function responseWith(result: unknown): unknown {
    return {
      schemaVersion: 1,
      kind: 'response',
      type: 'research.runs',
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      respondedAtMs: 1_724_000_000_001,
      result,
    };
  }

  it('carries all four outcomes distinctly', () => {
    expect(outcomeStatusSchema.options).toEqual(['ok', 'failed', 'blocked', 'unknown']);
    for (const status of ['failed', 'blocked', 'unknown'] as const) {
      const parsed = schema.safeParse(
        responseWith({ status, issues: [{ path: ['runs'], code: 'storage_rejected' }] }),
      );
      expect(parsed.success).toBe(true);
    }
    expect(schema.safeParse(responseWith({ status: 'ok', value: [] })).success).toBe(true);
  });

  it('will not accept a failure without at least one issue', () => {
    expect(schema.safeParse(responseWith({ status: 'failed', issues: [] })).success).toBe(false);
  });

  it('will not accept an outcome that carries both a value and issues', () => {
    expect(
      schema.safeParse(
        responseWith({ status: 'ok', value: [], issues: [{ path: ['x'], code: 'y' }] }),
      ).success,
    ).toBe(false);
  });

  it('refuses free text in an issue code, so a stack cannot travel as one', () => {
    expect(issueSchema.safeParse({ path: ['runs'], code: 'storage_rejected' }).success).toBe(true);
    expect(
      issueSchema.safeParse({
        path: ['runs'],
        code: 'ENOENT /Users/someone/private/dataset.parquet',
      }).success,
    ).toBe(false);
    expect(issueSchema.safeParse({ path: ['runs'], code: 'Error: boom' }).success).toBe(false);
  });
});

describe('risk evidence gate contract', () => {
  it('pins liveExecutionPermitted to false on the wire', () => {
    const schema = CHANNEL_SCHEMAS['risk.evidence-gate'].response;
    const base = {
      schemaVersion: 1,
      assessedAtMs: 1_724_000_000_000,
      status: 'requirements_not_met',
      trialHistoryComplete: true,
      source: null,
      facts: null,
      gates: [{ code: 'significance', met: false }],
      conversationEligible: false,
      liveExecutionPermitted: false,
      assessmentHash: 'a'.repeat(64),
    };
    expect(schema.safeParse(base).success).toBe(true);
    // Reaching the gate makes live considerable, never enabled. A main process
    // that tried to send true fails validation rather than lighting a control.
    expect(schema.safeParse({ ...base, liveExecutionPermitted: true }).success).toBe(false);
  });

  it('rejects a status outside the closed vocabulary', () => {
    const schema = CHANNEL_SCHEMAS['risk.evidence-gate'].response;
    expect(
      schema.safeParse({
        schemaVersion: 1,
        assessedAtMs: 1,
        status: 'looks_fine_to_me',
        trialHistoryComplete: true,
        source: null,
        facts: null,
        gates: [],
        conversationEligible: false,
        liveExecutionPermitted: false,
        assessmentHash: 'a'.repeat(64),
      }).success,
    ).toBe(false);
  });
});

describe('transport failures', () => {
  it('reports a boundary failure in the same shape as a service issue', () => {
    for (const code of TRANSPORT_ISSUE_CODES) {
      const outcome = transportFailure(code);
      expect(outcome.status).toBe('failed');
      expect(outcome.status === 'failed' && outcome.issues[0]).toEqual({
        path: ['transport'],
        code,
      });
      expect(issueSchema.safeParse({ path: ['transport'], code }).success).toBe(true);
    }
  });
});
