/**
 * Density tokens.
 *
 * `docs/UI-UX.md` §1: "Dense information is acceptable; ambiguous hierarchy is
 * not. Offer compact and comfortable density tokens rather than shrinking
 * isolated controls." The second clause is the reason this is a token set and
 * not a font-size override — a screen switches density by swapping one scale,
 * so a control can never end up smaller than its neighbours by accident.
 *
 * Comfortable is the default, matching
 * `DEFAULT_ACCOUNT_PRESENTATION_PREFERENCES` in
 * `packages/services/src/accounts/settings.ts`. The two must agree: the stored
 * preference is the source of truth and this is only its presentation.
 */

export type Density = 'comfortable' | 'compact';

export const DEFAULT_DENSITY: Density = 'comfortable';

export interface DensityScale {
  /** Table row height. Fixed so a changing value never reflows the row. */
  readonly rowHeightPx: number;
  readonly cellPaddingXPx: number;
  readonly cellPaddingYPx: number;
  readonly sectionGapPx: number;
  readonly controlHeightPx: number;
  readonly fontSizePx: number;
  readonly lineHeightPx: number;
}

/**
 * Both scales keep interactive controls at or above 24px.
 *
 * WCAG 2.2 target size (minimum) is 24×24 CSS pixels, and §8 lists WCAG 2.2 in
 * the research basis. Compact reduces row and section rhythm; it does not
 * shrink the things a user has to hit.
 */
export const DENSITY_SCALES: Readonly<Record<Density, DensityScale>> = {
  comfortable: {
    rowHeightPx: 40,
    cellPaddingXPx: 12,
    cellPaddingYPx: 10,
    sectionGapPx: 24,
    controlHeightPx: 32,
    fontSizePx: 14,
    lineHeightPx: 20,
  },
  compact: {
    rowHeightPx: 28,
    cellPaddingXPx: 8,
    cellPaddingYPx: 4,
    sectionGapPx: 14,
    controlHeightPx: 24,
    fontSizePx: 13,
    lineHeightPx: 18,
  },
};

/** Minimum interactive target, in CSS pixels (WCAG 2.2 target size, minimum). */
export const MINIMUM_TARGET_PX = 24;

/**
 * CSS custom properties for one density, applied at the app root.
 *
 * Returned as data rather than injected: a `<style>` element would be refused
 * by the renderer's `style-src 'self'` policy, and ADR-0005 selected a
 * primitive layer specifically to avoid needing a CSP nonce. These are set via
 * CSSOM on the root element, which CSP does not govern.
 */
export function densityCustomProperties(density: Density): Readonly<Record<string, string>> {
  const scale = DENSITY_SCALES[density] ?? DENSITY_SCALES[DEFAULT_DENSITY];
  return {
    '--density-row-height': `${scale.rowHeightPx}px`,
    '--density-cell-padding-x': `${scale.cellPaddingXPx}px`,
    '--density-cell-padding-y': `${scale.cellPaddingYPx}px`,
    '--density-section-gap': `${scale.sectionGapPx}px`,
    '--density-control-height': `${scale.controlHeightPx}px`,
    '--density-font-size': `${scale.fontSizePx}px`,
    '--density-line-height': `${scale.lineHeightPx}px`,
  };
}

/** Narrow an untrusted stored value onto the token set. */
export function resolveDensity(value: unknown): Density {
  return value === 'compact' || value === 'comfortable' ? value : DEFAULT_DENSITY;
}
