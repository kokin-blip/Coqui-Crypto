export type RiskAssessmentAvailabilityV2 = 'assessed' | 'unassessed' | 'unavailable' | 'stale' | 'stand_down';

/** Presentation-neutral truthfulness contract: missing observations remain null, never favorable zeroes. */
export interface RiskAssessmentStateV2 {
  readonly schemaVersion: 2;
  readonly availability: RiskAssessmentAvailabilityV2;
  readonly stage: string | null;
  readonly exposureScale: number | null;
  readonly drawdownPct: number | null;
  readonly expectedShortfallPct: number | null;
  readonly reasonCode: string | null;
  readonly assessedAtMs: number;
}
