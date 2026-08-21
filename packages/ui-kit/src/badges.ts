/**
 * The three badges that carry Coqui's honesty machinery into the interface.
 *
 * `ARCHITECTURE.md` §9 makes provenance a functional requirement rather than
 * decoration, and `docs/UI-UX.md` §0 forbids exposing it only on hover. These
 * are the presentation contracts for that; the logic is pure so it can be
 * tested without rendering, and every one of them pairs its colour with a
 * label and a shape (§1).
 */

export type FreshnessLevel = 'fresh' | 'aging' | 'stale' | 'unknown';

export interface FreshnessBadge {
  readonly level: FreshnessLevel;
  /** Shape carries the state under forced colors, where hue does not. */
  readonly marker: string;
  readonly text: string;
  readonly label: string;
}

function relativeAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function freshnessBadge(level: FreshnessLevel, ageMs: number | null): FreshnessBadge {
  const age = ageMs === null || ageMs < 0 ? null : relativeAge(ageMs);
  switch (level) {
    case 'fresh':
      return { level, marker: '●', text: age ?? 'fresh', label: `data is fresh${age ? `, ${age}` : ''}` };
    case 'aging':
      return { level, marker: '◐', text: age ?? 'aging', label: `data is ageing${age ? `, ${age}` : ''}` };
    case 'stale':
      return { level, marker: '○', text: age ?? 'stale', label: `data is stale${age ? `, ${age}` : ''}` };
    default:
      // Not a synonym for fresh. Several free feeds publish no timestamp, and
      // claiming freshness we cannot observe is the false confidence this
      // project exists to avoid.
      return { level, marker: '?', text: 'no timestamp', label: 'the source publishes no observation time' };
  }
}

export interface ProvenanceBadge {
  readonly source: string;
  /** Short hash for display; the full value belongs in the detail view. */
  readonly datasetHash: string | null;
  readonly informationalOnly: boolean;
  readonly text: string;
  readonly label: string;
}

export function provenanceBadge(input: {
  readonly source: string;
  readonly datasetHash?: string | null;
  readonly informationalOnly: boolean;
}): ProvenanceBadge {
  const short = input.datasetHash == null ? null : `${input.datasetHash.slice(0, 8)}…`;
  const kind = input.informationalOnly ? 'reference' : 'decision data';
  return {
    source: input.source,
    datasetHash: short,
    informationalOnly: input.informationalOnly,
    text: short === null ? input.source : `${input.source} · ${short}`,
    label: `${kind} from ${input.source}${short === null ? '' : `, dataset ${short}`}`,
  };
}

/**
 * Validation state of a displayed strategy figure.
 *
 * `unvalidated` is the current state of every strategy parameter in this build:
 * P3's replacement study was negative, so no adopted study backs the defaults.
 * It is a required annotation, not an optional one.
 */
export type ValidationLevel = 'unvalidated' | 'upper-bound' | 'validated';

export interface ValidationBadge {
  readonly level: ValidationLevel;
  readonly marker: string;
  readonly text: string;
  readonly label: string;
}

export function validationBadge(
  level: ValidationLevel,
  trialCount: number | null,
): ValidationBadge {
  switch (level) {
    case 'validated':
      return {
        level,
        marker: '✓',
        text: trialCount === null ? 'validated' : `validated · ${trialCount} trials`,
        label: 'an adopted study backs this figure',
      };
    case 'upper-bound':
      // The direction of the bound is the claim. A bare DSR would overstate it.
      return {
        level,
        marker: '▲',
        text: trialCount === null ? 'upper bound' : `upper bound · ${trialCount} trials`,
        label:
          `deflated against an upper bound of ${trialCount ?? 'an unknown number of'} trials; ` +
          'the true count is no larger, so a figure that clears here clears at the true count',
      };
    default:
      return {
        level,
        marker: '!',
        text: 'not validated',
        label: 'legacy default — no adopted study backs this figure',
      };
  }
}

export type RiskStage = 0 | 1 | 2 | 3 | 4 | 5;

export interface RiskBadge {
  readonly stage: RiskStage;
  readonly text: string;
  readonly label: string;
}

export function riskBadge(stage: RiskStage): RiskBadge {
  return {
    stage,
    text: `stage ${stage} of 5`,
    label: `risk stage ${stage} of 5`,
  };
}
