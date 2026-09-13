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
      'accounts.coinbase.connect', 'accounts.coinbase.connect-json', 'accounts.coinbase.disconnect', 'accounts.coinbase.status', 'accounts.coinbase.sync',
      'accounts.profile.switch', 'accounts.profiles', 'accounts.settings', 'accounts.settings.set',
      'accounts.workspace', 'accounts.workspace.set', 'activity.feed',
      'advisor.chat.history', 'advisor.chat.history.delete', 'advisor.chat.history.export',
      'advisor.chat.send', 'advisor.context.prepare', 'advisor.decision.explain', 'advisor.evidence.explain', 'advisor.facts.generate', 'advisor.navigation',
      'advisor.provider.connect', 'advisor.provider.connect-copied', 'advisor.provider.disconnect', 'advisor.provider.verify', 'advisor.providers',
      'alerts.view', 'app.chart.snapshot.save', 'app.chart.workspace', 'app.chart.workspace.set', 'app.incidents',
      'app.onboarding.complete', 'app.onboarding.restart', 'app.onboarding.skip', 'app.onboarding.status',
      'app.person', 'app.person.set', 'app.profile-readiness',
      'app.status-rail',
      'chart-extensions.catalog', 'chart-extensions.evaluate', 'chart-extensions.install', 'chart-extensions.install.pick',
      'chart-extensions.remove', 'chart-extensions.set', 'chart-extensions.signer.remove', 'chart-extensions.signer.trust',
      'connections.connect-file', 'connections.disconnect', 'connections.list', 'connections.rename',
      'connections.robinhood.keypair.begin', 'connections.robinhood.keypair.cancel', 'connections.robinhood.keypair.complete',
      'connections.robinhood.keypair.status',
      'connections.status', 'connections.sync',
      'decision.detail', 'decision.timeline', 'market-data.candles',
      'market-data.display-bars',
      'market-data.fear-greed',
      'market-data.live',
      'market-data.live-candles',
      'market-data.markets',
      'market-data.news',
      'market-data.prices',
      'market-data.products',
      'market-data.trending',
      'market-data.yields',
      'market-events.ingest-file', 'market-events.ingest-local', 'market-events.timeline', 'operations.floor',
      'paper.campaign', 'paper.campaign.connections',
      'paper.campaign.connections.start', 'paper.campaign.kill-switch',
      'paper.execution.policy',
      'paper.execution.policy.set',
      'paper.execution.prepare',
      'paper.execution.proposal',
      'paper.execution.proposals',
      'paper.execution.review',
      'paper.exploratory.evaluate-now',
      'paper.exploratory.pause',
      'paper.exploratory.performance',
      'paper.exploratory.portfolio',
      'paper.exploratory.resume',
      'paper.exploratory.start',
      'paper.exploratory.status',
      'paper.exploratory.stop',
      'paper.performance',
      'paper.performance-day',
      'paper.portfolio',
      'portfolio.allocation',
      'portfolio.current',
      'portfolio.history',
      'portfolio.reconciliation',
      'portfolio.reconciliation.resolve',
      'portfolio.tax',
      'portfolio.view',
      'research.candidate.review', 'research.candidate.rollback', 'research.edge-study',
      'research.job',
      'research.jobs', 'research.lineage',
      'research.negative-findings',
      'research.performance',
      'research.runs',
      'research.scoreboard', 'research.trigger-status', 'risk.dashboard',
      'risk.evidence-gate',
    ]);
  });

  it('refuses a channel name that is not registered', () => {
    expect(isChannelName('market-data.prices')).toBe(true);
    expect(isChannelName('market-data.everything')).toBe(false);
    expect(isChannelName('__proto__')).toBe(false);
    expect(isChannelName(null)).toBe(false);
  });

  it('classifies every channel, and names the one write', () => {
    expect([...CHANNEL_KINDS.read, ...CHANNEL_KINDS.write].sort())
      .toEqual([...CHANNEL_NAMES].sort());
    expect(CHANNEL_KINDS.write).toEqual([
      'accounts.coinbase.connect', 'accounts.coinbase.connect-json', 'accounts.coinbase.disconnect',
      'accounts.coinbase.sync', 'accounts.profile.switch',
      'accounts.settings.set', 'accounts.workspace.set',
      'app.person.set', 'app.onboarding.skip', 'app.onboarding.restart', 'app.onboarding.complete',
      'connections.connect-file',
      'connections.robinhood.keypair.begin', 'connections.robinhood.keypair.complete', 'connections.robinhood.keypair.cancel',
      'connections.rename',
      'connections.disconnect',
      'connections.sync',
      'app.chart.snapshot.save',
      'app.chart.workspace.set',
      'advisor.chat.history.delete', 'advisor.chat.history.export',
      'advisor.chat.send', 'advisor.decision.explain', 'advisor.evidence.explain', 'advisor.facts.generate', 'advisor.navigation',
      'advisor.provider.connect', 'advisor.provider.connect-copied', 'advisor.provider.verify', 'advisor.provider.disconnect',
      'chart-extensions.install',
      'chart-extensions.install.pick',
      'chart-extensions.remove',
      'chart-extensions.set',
      'chart-extensions.signer.remove', 'chart-extensions.signer.trust',
      'market-events.ingest-local', 'market-events.ingest-file',
      'paper.campaign.kill-switch',
      'paper.campaign.connections.start',
      'paper.exploratory.start',
      'paper.exploratory.pause',
      'paper.exploratory.resume',
      'paper.exploratory.stop',
      'paper.exploratory.evaluate-now',
      'paper.execution.policy.set',
      'paper.execution.prepare',
      'paper.execution.review',
      'portfolio.reconciliation.resolve',
      'research.candidate.review', 'research.candidate.rollback',
    ]);
    expect(CHANNEL_KINDS.read).not.toContain('portfolio.reconciliation.resolve');
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
    const base = {
      discrepancies: [item],
      lastRunAtMs: null,
      exceptions: [{ discrepancy: item, resolution: null, history: [] }],
      unresolvedCount: 1,
      options: [
        {
          kind: 'investigating',
          label: 'Still investigating',
          explanation: 'Keeps the exception open deliberately.',
          requiresLot: false,
        },
      ],
    };
    expect(schema.safeParse(base).success).toBe(true);
    // Invariant 12 makes closing an exception a recorded user decision. A
    // resolved flag on the *evidence* would invite a UI that clears them; the
    // decision lives in its own append-only row instead.
    expect(
      schema.safeParse({ ...base, discrepancies: [{ ...item, resolved: true }] }).success,
    ).toBe(false);
  });

  it('offers no resolution that touches a tax lot', () => {
    const kinds = CHANNEL_SCHEMAS['portfolio.reconciliation.resolve'].request;
    const valid = {
      commandId: '3f8a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
      discrepancyId: 'a'.repeat(64),
      linkedLotId: null,
      note: 'Transferred in from a hardware wallet.',
    };
    expect(kinds.safeParse({ ...valid, kind: 'external_transfer_in' }).success).toBe(true);
    // The wire refuses the two things the predecessor did. Invariant 12 is
    // enforced at the boundary, not only in the service.
    expect(kinds.safeParse({ ...valid, kind: 'create_zero_basis_lot' }).success).toBe(false);
    expect(kinds.safeParse({ ...valid, kind: 'rescale_lots' }).success).toBe(false);
    // And a resolution with no explanation cannot even be expressed.
    expect(kinds.safeParse({ ...valid, kind: 'provider_error', note: '' }).success).toBe(false);
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
        { trackId: 'hold', afterCostReturnPct: 11.2, maxDrawdownPct: -44.1,
          sortino: 0.38, sharpe: 0.3, dsr: null, trialCount: null,
          excessReturnVsHoldPct: null, excessReturnVsPassivePct: null },
      ],
      sampleDays: 32,
      datasetHash: 'b'.repeat(64),
      codeRevision: '037927e',
      runHash: 'f'.repeat(64),
      parametersValidated: false,
    };
    expect(schema.safeParse(base).success).toBe(true);

    // The negative P3 replacement run cannot claim the defaults are validated.
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
      riskAssessmentState: 'unassessed',
      riskStage: null,
      portfolioState: 'unavailable',
      paperAdmissionMode: 'validated',
      exploratoryCampaignStatus: null,
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
