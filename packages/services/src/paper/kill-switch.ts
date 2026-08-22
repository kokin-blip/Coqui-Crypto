import { getWalletRiskState, getWalletSafetyStop, type Db } from '@coqui/storage';

/**
 * The single authority on whether execution is halted.
 *
 * There are two independent halt sources and they mean different things. The
 * risk ladder sets `wallet_risk_state.hard_stopped` when a drawdown breaches
 * its limit; `wallet_safety_stop_state.active` records an explicit stop,
 * including the manual kill switch that migration 25 carried over from the
 * predecessor's `app_settings` key.
 *
 * Either halts everything. Reading only one is how a manual kill switch ends
 * up displayed as "armed·off" — which is exactly what the status rail did
 * before this existed. One predicate, used by both the rail and the execution
 * gate, so the two cannot disagree about whether trading is stopped.
 */
export type KillSwitchReason = 'risk_hard_stop' | 'safety_stop' | null;

export interface KillSwitchState {
  readonly engaged: boolean;
  readonly reason: KillSwitchReason;
  /** Operator-supplied text for a safety stop; never a provider or error string. */
  readonly detail: string | null;
}

export function resolveKillSwitch(profileId: string, database: Db): KillSwitchState {
  const risk = getWalletRiskState(profileId, database);
  if (risk?.hardStopped === true) {
    return { engaged: true, reason: 'risk_hard_stop', detail: risk.reason };
  }

  const safetyStop = getWalletSafetyStop(profileId, database);
  if (safetyStop?.active === true) {
    return { engaged: true, reason: 'safety_stop', detail: safetyStop.reason };
  }

  return { engaged: false, reason: null, detail: null };
}
