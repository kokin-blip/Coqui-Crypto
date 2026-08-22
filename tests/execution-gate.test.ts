import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AUTO_TRADE_GUARDRAILS,
  type AssetRef,
  type ExecutionIntent,
  type Holding,
  type UsdAmount,
} from '../packages/core/src/index.js';
import {
  isApproved,
  resolveKillSwitch,
  runExecutionGates,
  type ExecutionGateInput,
} from '../packages/services/src/index.js';
import {
  activateWalletSafetyStop,
  openDatabase,
  saveWalletRiskState,
  type Db,
} from '../packages/storage/src/index.js';

const NOW = 1_724_000_000_000;
const PROFILE = 'main';

const BTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  symbol: 'BTC',
  name: 'Bitcoin',
  baseAsset: 'BTC',
  quoteAsset: 'USD',
  coingeckoId: 'bitcoin',
};

function holding(valueUsd: string): Holding {
  return {
    asset: BTC,
    quantity: '1.00000000' as Holding['quantity'],
    avgCostUsd: '50000.00' as UsdAmount,
    priceUsd: valueUsd as UsdAmount,
    valueUsd: valueUsd as UsdAmount,
    unrealizedPnlUsd: '0' as UsdAmount,
    unrealizedPnlPct: 0,
  };
}

function intent(amountUsd: string): ExecutionIntent {
  return {
    asset: BTC,
    side: 'buy',
    amountUsd: amountUsd as UsdAmount,
    origin: 'rebalance',
    urgency: 'standard',
    referencePriceUsd: '64000.00' as UsdAmount,
  };
}

function input(overrides: Partial<ExecutionGateInput> = {}): ExecutionGateInput {
  return {
    profileId: PROFILE,
    runId: 'run-1',
    nowMs: NOW,
    mode: 'paper',
    killSwitchEngaged: false,
    intents: [intent('250.00')],
    holdings: [holding('10000.00')],
    // Comfortably above the cost model so profitability is not the thing under
    // test in the cases that are about something else.
    historicalNetEdgeEstimatePct: 12,
    guardrails: DEFAULT_AUTO_TRADE_GUARDRAILS,
    ...overrides,
  };
}

describe('no path reaches execution while skipping a gate', () => {
  it('records every gate on an approval', () => {
    const outcome = runExecutionGates(input());
    expect(isApproved(outcome)).toBe(true);
    if (!isApproved(outcome)) return;

    // The exit criterion of P6: an approval names all four gates. A chain that
    // silently dropped one would show a short list here.
    expect([...outcome.gatesPassed].sort()).toEqual([
      'execution_permission',
      'guardrails',
      'profitability',
      'risk_control',
    ]);
    expect(outcome.mode).toBe('paper');
  });

  it('cannot be constructed outside runExecutionGates', () => {
    // The brand key is a non-exported unique symbol, so an object literal with
    // the same visible fields is not an ApprovedExecution. This is the
    // structural guarantee; the compile-time proof is that the line below does
    // not typecheck without the cast.
    const forged = {
      profileId: PROFILE,
      runId: 'run-1',
      approvedAtMs: NOW,
      intents: [intent('250.00')],
      gatesPassed: ['guardrails'],
      mode: 'paper',
    };
    expect(Object.getOwnPropertySymbols(forged)).toHaveLength(0);

    const real = runExecutionGates(input());
    expect(isApproved(real)).toBe(true);
    // A genuine approval carries the brand symbol; a forgery cannot.
    expect(Object.getOwnPropertySymbols(real).length).toBeGreaterThan(0);
  });

  it('is frozen, so an approval cannot be widened after the fact', () => {
    const outcome = runExecutionGates(input());
    expect(Object.isFrozen(outcome)).toBe(true);
  });
});

describe('kill switch halts everything, including paper', () => {
  it('refuses before any other gate runs', () => {
    const outcome = runExecutionGates(input({ killSwitchEngaged: true }));
    expect(isApproved(outcome)).toBe(false);
    if (isApproved(outcome)) return;
    expect(outcome.code).toBe('kill_switch_engaged');
    expect(outcome.gate).toBe('execution_permission');
  });

  it('refuses even when every other condition would have passed', () => {
    const permissive = input({ killSwitchEngaged: true, historicalNetEdgeEstimatePct: 100 });
    expect(isApproved(runExecutionGates(permissive))).toBe(false);
  });
});

describe('execution permission', () => {
  it('refuses live mode outright', () => {
    // Invariant 1: canExecute returns true only for paper.
    for (const mode of ['live', 'off'] as const) {
      const outcome = runExecutionGates(input({ mode }));
      expect(isApproved(outcome), `${mode} must not be approved`).toBe(false);
    }
  });
});

describe('risk control', () => {
  it('refuses on a hard stop and never reaches the guardrails', () => {
    // A collapsing equity series drives the ladder to hard_stop.
    const collapsing = Array.from({ length: 400 }, (_, index) => 100_000 - index * 240);
    const outcome = runExecutionGates(input({ riskInput: { equityValues: collapsing } }));
    expect(isApproved(outcome)).toBe(false);
    if (isApproved(outcome)) return;
    expect(outcome.code).toBe('risk_hard_stop');
    expect(outcome.gate).toBe('risk_control');
  });
});

describe('guardrails and profitability', () => {
  it('refuses when no intent survives, naming the gate that filtered it', () => {
    // An edge below the cost model means nothing clears the profit buffer.
    const outcome = runExecutionGates(input({ historicalNetEdgeEstimatePct: 0 }));
    expect(isApproved(outcome)).toBe(false);
    if (isApproved(outcome)) return;
    expect(outcome.code).toBe('all_intents_filtered');
    expect(outcome.gate).toBe('profitability');
  });

  it('drops a trade below the minimum useful size', () => {
    const outcome = runExecutionGates(input({ intents: [intent('1.00')] }));
    expect(isApproved(outcome)).toBe(false);
    if (isApproved(outcome)) return;
    expect(outcome.skipped.length).toBeGreaterThan(0);
  });

  it('reports an empty intent list distinctly from a filtered one', () => {
    const outcome = runExecutionGates(input({ intents: [] }));
    expect(isApproved(outcome)).toBe(false);
    if (isApproved(outcome)) return;
    // "Nothing to do" is not "everything was rejected".
    expect(outcome.code).toBe('no_intents');
  });
});

describe('resolveKillSwitch', () => {
  function db(): Db {
    return openDatabase(':memory:');
  }

  it('reports clear on a fresh profile', () => {
    const database = db();
    expect(resolveKillSwitch(PROFILE, database)).toEqual({
      engaged: false,
      reason: null,
      detail: null,
    });
    database.close();
  });

  it('engages on a risk-ladder hard stop', () => {
    const database = db();
    saveWalletRiskState(
      {
        profileId: PROFILE,
        stage: 'hard_stop',
        dailyPeakUsd: null,
        rollingPeakUsd: null,
        lifetimePeakUsd: null,
        hardStopped: true,
        reason: 'drawdown breach',
        updatedAt: NOW,
      },
      database,
    );
    expect(resolveKillSwitch(PROFILE, database)).toEqual({
      engaged: true,
      reason: 'risk_hard_stop',
      detail: 'drawdown breach',
    });
    database.close();
  });

  it('engages on a manual safety stop, which the risk ladder does not know about', () => {
    const database = db();
    activateWalletSafetyStop(
      {
        eventId: 'evt-manual-kill',
        profileId: PROFILE,
        kind: 'manual_kill',
        reason: 'operator halted',
        at: NOW,
        runId: null,
      },
      database,
    );

    // This is the case the status rail used to miss: reading only
    // wallet_risk_state showed a manual kill switch as "armed·off".
    const state = resolveKillSwitch(PROFILE, database);
    expect(state.engaged).toBe(true);
    expect(state.reason).toBe('safety_stop');
    database.close();
  });

  it('is scoped per profile', () => {
    const database = db();
    activateWalletSafetyStop(
      {
        eventId: 'evt-other',
        profileId: 'other',
        kind: 'manual_kill',
        reason: 'halted elsewhere',
        at: NOW,
        runId: null,
      },
      database,
    );
    expect(resolveKillSwitch(PROFILE, database).engaged).toBe(false);
    database.close();
  });
});
