import { sha256Hex } from '../crypto/sha256.js';
import { DEFAULT_TRADE_COST_CONFIG, tradeCostConfigHash, type TradeCostConfig } from './index.js';
export type CostScenarioName = 'optimistic' | 'account' | 'conservative' | 'stress';
export interface VersionedCostScenario {
  readonly id: string;
  readonly scenario: CostScenarioName;
  readonly venue: 'coinbase';
  readonly productType: 'spot';
  readonly source: 'venue_public' | 'account_snapshot' | 'research_assumption';
  readonly sourceRef: string;
  readonly effectiveAtMs: number;
  readonly liquidityRole: 'maker' | 'taker';
  readonly makerExecutionModeled: boolean;
  readonly makerFeeBps: number;
  readonly takerFeeBps: number;
  readonly config: TradeCostConfig;
}
export function costScenarioHash(profile: VersionedCostScenario): string {
  if (!profile.id || !profile.sourceRef || !Number.isSafeInteger(profile.effectiveAtMs) || profile.effectiveAtMs < 0 ||
      profile.venue !== 'coinbase' || profile.productType !== 'spot' ||
      !['optimistic', 'account', 'conservative', 'stress'].includes(profile.scenario) ||
      !['venue_public', 'account_snapshot', 'research_assumption'].includes(profile.source) ||
      !['maker', 'taker'].includes(profile.liquidityRole) ||
      [profile.makerFeeBps, profile.takerFeeBps].some((v) => !Number.isFinite(v) || v < 0) ||
      (profile.liquidityRole === 'maker' && !profile.makerExecutionModeled) ||
      (profile.scenario === 'account' && profile.source !== 'account_snapshot') ||
      profile.config.feeBps !== (profile.liquidityRole === 'maker' ? profile.makerFeeBps : profile.takerFeeBps)) {
    throw new TypeError('Invalid versioned cost scenario');
  }
  return sha256Hex(JSON.stringify({ id: profile.id, scenario: profile.scenario, venue: profile.venue,
    productType: profile.productType, source: profile.source, sourceRef: profile.sourceRef,
    effectiveAtMs: profile.effectiveAtMs, liquidityRole: profile.liquidityRole,
    makerExecutionModeled: profile.makerExecutionModeled, makerFeeBps: profile.makerFeeBps,
    takerFeeBps: profile.takerFeeBps, configHash: tradeCostConfigHash(profile.config) }));
}
export function freezeCostScenario(profile: VersionedCostScenario): VersionedCostScenario {
  costScenarioHash(profile);
  return Object.freeze({ ...profile, config: Object.freeze({ ...profile.config }) });
}
/** Dated US public assumption, not the owner's tier or a retroactive fee schedule. */
export function coinbaseResearchScenarios(account?: VersionedCostScenario): readonly VersionedCostScenario[] {
  const common = { venue: 'coinbase', productType: 'spot', effectiveAtMs: Date.UTC(2026, 8, 16),
    liquidityRole: 'taker', makerExecutionModeled: false,
    sourceRef: 'https://www.coinbase.com/blog/were-lowering-fees-for-many-active-traders-on-coinbase-advanced' } as const;
  const conservative = freezeCostScenario({ ...common, id: 'coinbase-us-public-2026-09-16', scenario: 'conservative',
    source: 'venue_public', makerFeeBps: 50, takerFeeBps: 90,
    config: { ...DEFAULT_TRADE_COST_CONFIG, modelVersion: 'coinbase-us-public-2026-09-16', feeBps: 90, impactCoefBps: 60 } });
  const optimistic = freezeCostScenario({ ...common, id: 'legacy-friction-optimistic-v2', scenario: 'optimistic',
    source: 'research_assumption', makerFeeBps: 40, takerFeeBps: 60, config: { ...DEFAULT_TRADE_COST_CONFIG } });
  const stress = freezeCostScenario({ ...conservative, id: 'coinbase-us-public-2026-09-16-double', scenario: 'stress',
    source: 'research_assumption', makerFeeBps: 100, takerFeeBps: 180,
    config: { ...conservative.config, modelVersion: 'coinbase-us-public-2026-09-16-double', feeBps: 180,
      spreadBps: 20, slippageBps: 30, impactCoefBps: 120 } });
  if (account && account.scenario !== 'account') throw new TypeError('Account cost evidence required');
  return Object.freeze([optimistic, ...(account ? [freezeCostScenario(account)] : []), conservative, stress]);
}
