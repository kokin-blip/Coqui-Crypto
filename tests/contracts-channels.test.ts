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
      'accounts.settings',
      'app.status-rail',
      'market-data.candles',
      'market-data.fear-greed',
      'market-data.markets',
      'market-data.news',
      'market-data.prices',
      'market-data.trending',
      'market-data.yields',
      'portfolio.allocation',
      'portfolio.reconciliation',
      'portfolio.tax',
      'portfolio.view',
      'research.job',
      'research.jobs',
      'research.negative-findings',
      'research.runs',
      'research.scoreboard',
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

describe('portfolio contract', () => {
  it('carries estimateOnly across IPC as a literal true', () => {
    const schema = CHANNEL_SCHEMAS['portfolio.allocation'].response;
    const base = {
      policy: { targets: [], rebalanceBandPct: 5 },
      allocation: { slices: [], totalValueUsd: '0', asOf: 1_724_000_000_000 },
      plan: {
        trades: [],
        turnoverUsd: '0',
        maxDriftPct: 0,
        asOf: 1_724_000_000_000,
        estimateOnly: true,
      },
      planStatus: 'no_policy',
    };
    expect(schema.safeParse(base).success).toBe(true);
    // A plan is an estimate no executor may act on. Enforcing that only in
    // core's types would let the guarantee stop at the process boundary.
    expect(
      schema.safeParse({ ...base, plan: { ...base.plan, estimateOnly: false } }).success,
    ).toBe(false);
  });

  it('keeps an unpriced holding null across every money field', () => {
    const schema = CHANNEL_SCHEMAS['portfolio.view'].response;
    const asset = {
      instrument: { venue: 'coinbase', productId: 'XYZ-USD', productType: 'spot' },
      symbol: 'XYZ',
      name: 'Example',
      baseAsset: 'XYZ',
      quoteAsset: 'USD',
      coingeckoId: null,
    };
    const base = {
      asOfMs: 1_724_000_000_000,
      holdings: [
        {
          asset,
          quantity: '100.00000000',
          avgCostUsd: '205.00',
          // A zero here would silently fold the position into a total.
          priceUsd: null,
          valueUsd: null,
          unrealizedPnlUsd: null,
          unrealizedPnlPct: null,
          priceProvenance: null,
        },
      ],
      valuation: {
        totalValueUsd: '0',
        totalCostUsd: '205.00',
        pricedCostUsd: '0',
        totalUnrealizedPnlUsd: '0',
        totalUnrealizedPnlPct: null,
        pricedCount: 0,
        unpricedCount: 1,
      },
      pricing: {
        requestedSource: 'coinbase+coingecko',
        requestedAtMs: 1_724_000_000_000,
        receivedAtMs: 1_724_000_000_100,
        requestedCount: 1,
        pricedCount: 0,
        unpricedCount: 1,
        sources: [],
        status: 'unavailable',
      },
    };
    expect(schema.safeParse(base).success).toBe(true);
  });

  it('permits a priced holding with no observation time', () => {
    const schema = CHANNEL_SCHEMAS['portfolio.view'].response;
    expect(
      schema.safeParse({
        asOfMs: 1_724_000_000_000,
        holdings: [
          {
            asset: {
              instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
              symbol: 'BTC',
              name: 'Bitcoin',
              baseAsset: 'BTC',
              quoteAsset: 'USD',
              coingeckoId: 'bitcoin',
            },
            quantity: '0.10424000',
            avgCostUsd: '6010.00',
            priceUsd: '64001.12',
            valueUsd: '6671.47',
            unrealizedPnlUsd: '661.47',
            unrealizedPnlPct: 11,
            priceProvenance: {
              source: 'coingecko',
              quality: 'reference_market',
              // Nullable by design: a surface must render freshness-unknown as
              // its own state rather than substituting zero age.
              observedAtMs: null,
            },
          },
        ],
        valuation: {
          totalValueUsd: '6671.47',
          totalCostUsd: '6010.00',
          pricedCostUsd: '6010.00',
          totalUnrealizedPnlUsd: '661.47',
          totalUnrealizedPnlPct: 11,
          pricedCount: 1,
          unpricedCount: 0,
        },
        pricing: {
          requestedSource: 'coinbase+coingecko',
          requestedAtMs: 1_724_000_000_000,
          receivedAtMs: 1_724_000_000_100,
          requestedCount: 1,
          pricedCount: 1,
          unpricedCount: 0,
          sources: [{ source: 'coingecko', quality: 'reference_market', pricedCount: 1 }],
          status: 'complete',
        },
      }).success,
    ).toBe(true);
  });

  it('has no resolved flag on a reconciliation exception', () => {
    const schema = CHANNEL_SCHEMAS['portfolio.reconciliation'].response;
    const item = {
      id: 'a'.repeat(64),
      runId: 'run-1',
      receivedAtMs: 1_724_000_000_000,
      originProfileId: 'main',
      currency: 'SOL',
      kind: 'provider_exceeds_local',
      providerQuantity: '12.5',
      localQuantity: '12.0',
      deltaQuantity: '0.5',
    };
    expect(schema.safeParse({ discrepancies: [item], lastRunAtMs: null }).success).toBe(true);
    // Invariant 12 makes closing an exception a recorded user decision. A
    // resolved flag here would invite a UI that clears them.
    expect(
      schema.safeParse({
        discrepancies: [{ ...item, resolved: true }],
        lastRunAtMs: null,
      }).success,
    ).toBe(false);
  });
});

describe('scoreboard contract', () => {
  it('permits a null DSR and trial count on a benchmark row', () => {
    const schema = CHANNEL_SCHEMAS['research.scoreboard'].response;
    const base = {
      runId: 'trendvol-replacement-v1',
      completedAtMs: 1_723_000_000_000,
      adopted: false,
      tracks: [
        {
          trackId: 'hold',
          afterCostReturnPct: 11.2,
          maxDrawdownPct: -44.1,
          sortino: 0.38,
          sharpe: 0.3,
          dsr: null,
          trialCount: null,
          excessReturnVsHoldPct: null,
          excessReturnVsPassivePct: null,
        },
      ],
      sampleDays: 32,
      datasetHash: 'b'.repeat(64),
      codeRevision: '037927e',
      runHash: 'f'.repeat(64),
      parametersValidated: false,
    };
    expect(schema.safeParse(base).success).toBe(true);

    // Literal false: P3's replacement run was negative, so the wire type will
    // not carry a claim that the defaults are validated.
    expect(schema.safeParse({ ...base, parametersValidated: true }).success).toBe(false);
  });

  it('rejects a DSR outside the unit interval', () => {
    const schema = CHANNEL_SCHEMAS['research.scoreboard'].response;
    const track = {
      trackId: 'selected',
      afterCostReturnPct: 18.4,
      maxDrawdownPct: -31.7,
      sortino: 0.61,
      sharpe: 0.44,
      dsr: 1.4,
      trialCount: 215,
      excessReturnVsHoldPct: 7.2,
      excessReturnVsPassivePct: 14,
    };
    expect(
      schema.safeParse({
        runId: 'r',
        completedAtMs: 1,
        adopted: false,
        tracks: [track],
        sampleDays: null,
        datasetHash: 'b'.repeat(64),
        codeRevision: 'x',
        runHash: 'f'.repeat(64),
        parametersValidated: false,
      }).success,
    ).toBe(false);
  });
});

describe('status rail contract', () => {
  it('pins mode to paper on the wire', () => {
    const schema = CHANNEL_SCHEMAS['app.status-rail'].response;
    const base = {
      profileId: 'main',
      mode: 'paper',
      executionPermitted: true,
      killSwitchEngaged: false,
      killSwitchReason: null,
      riskStage: null,
      activeJobCount: 0,
      scheduledJobCount: 0,
      reconciliation: { lastRunAtMs: null, unresolvedCount: 0, neverRun: true },
      costModelBps: 85,
      assessedAtMs: 1_724_000_000_000,
    };
    expect(schema.safeParse(base).success).toBe(true);
    // Invariant 1: this build has no other executable mode, and the wire type
    // refuses to describe one.
    expect(schema.safeParse({ ...base, mode: 'live' }).success).toBe(false);
    expect(schema.safeParse({ ...base, mode: 'off' }).success).toBe(false);
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
