import type { OverlayCandidate } from './types.js';
export interface ParticipationDecision { readonly permitted: boolean; readonly reason: string }
export function ruleParticipation(candidate: OverlayCandidate, mix: readonly number[], targetVolPct: number): ParticipationDecision {
  if (candidate.gate === 'none' || candidate.gate === 'ml') return { permitted: true, reason: 'no_rule_gate' };
  const trendNeeded = candidate.gate !== 'volatility', volNeeded = candidate.gate !== 'trend';
  if (!Number.isFinite(targetVolPct) || targetVolPct <= 0 || mix.some((v) => !Number.isFinite(v) || v <= 0) ||
      mix.length < (trendNeeded ? 100 : 31)) return { permitted: false, reason: 'gate_inputs_unavailable' };
  if (trendNeeded) {
    const sma = mix.slice(-100).reduce((s, v) => s + v, 0) / 100;
    if (mix.at(-1)! < sma) return { permitted: false, reason: 'below_trend' };
  }
  if (volNeeded) {
    const values = mix.slice(-31), returns = values.slice(1).map((v, i) => v / values[i]! - 1);
    const mean = returns.reduce((s, v) => s + v, 0) / 30;
    const vol = Math.sqrt(returns.reduce((s, v) => s + (v - mean) ** 2, 0) / 30) * Math.sqrt(365) * 100;
    if (vol > targetVolPct * candidate.volatilityMultiple) return { permitted: false, reason: 'excess_volatility' };
  }
  return { permitted: true, reason: 'rule_permitted' };
}
