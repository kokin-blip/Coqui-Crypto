/**
 * Financial number formatting.
 *
 * Three rules from `docs/UI-UX.md` §1 are enforced here rather than left to
 * each screen: values align on the decimal, units stay visible, and direction
 * is never carried by color alone. A component that formats its own numbers can
 * break all three quietly, so feature code is not permitted to.
 *
 * Everything takes an exact decimal string. Invariant 11 forbids binary float
 * for balances, prices and P&L, and `Number.prototype.toFixed` on a parsed
 * float would reintroduce exactly the error the contract works to avoid.
 */

export type Direction = 'up' | 'down' | 'flat';

export interface SignedFigure {
  /** Digits only, no sign and no unit. */
  readonly magnitude: string;
  readonly direction: Direction;
  /** `+`, `−` (U+2212 minus, not a hyphen) or an empty string. */
  readonly sign: string;
  /** `▲`, `▼` or `–`. Shape, so direction survives forced-colors mode. */
  readonly marker: string;
  /** Spoken form for assistive technology, where a glyph is meaningless. */
  readonly label: string;
}

const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

function isZero(magnitude: string): boolean {
  return /^0(?:\.0*)?$/u.test(magnitude);
}

/**
 * Split an exact decimal string into sign, magnitude, and a non-color direction
 * cue. Returns `null` for anything that is not an exact decimal, so a caller
 * renders an explicit unavailable state rather than `NaN`.
 */
export function signedFigure(value: string): SignedFigure | null {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return null;

  const negative = value.startsWith('-');
  const magnitude = negative ? value.slice(1) : value;

  if (isZero(magnitude)) {
    return { magnitude, direction: 'flat', sign: '', marker: '–', label: 'unchanged' };
  }
  return negative
    ? { magnitude, direction: 'down', sign: '−', marker: '▼', label: 'down' }
    : { magnitude, direction: 'up', sign: '+', marker: '▲', label: 'up' };
}

/**
 * Pad a decimal string to a fixed number of fractional digits *without*
 * rounding through a float. Digits beyond the requested precision are kept, not
 * truncated: silently dropping a significant digit from a balance is worse than
 * a slightly wider column.
 */
export function alignDecimal(value: string, fractionDigits: number): string | null {
  if (!DECIMAL.test(value) || !Number.isSafeInteger(fractionDigits) || fractionDigits < 0) {
    return null;
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length >= fractionDigits) return value;
  return `${whole}.${fraction.padEnd(fractionDigits, '0')}`;
}

/** Group the integer part with thin separators, leaving the fraction intact. */
export function groupDigits(value: string): string | null {
  if (!DECIMAL.test(value)) return null;
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const [whole = '', fraction] = body.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const joined = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  return negative ? `−${joined}` : joined;
}

export interface FormattedUsd {
  readonly text: string;
  readonly figure: SignedFigure;
}

/**
 * USD with the unit attached and the sign spelled out.
 *
 * `signed` is for deltas, where a leading `+` carries meaning. A balance is
 * rendered unsigned because "+$12,481.06" implies a change that did not happen.
 */
export function formatUsd(value: string, options: { readonly signed?: boolean } = {}):
  | FormattedUsd
  | null {
  const figure = signedFigure(value);
  if (figure === null) return null;
  const aligned = alignDecimal(figure.magnitude, 2);
  if (aligned === null) return null;
  const grouped = groupDigits(aligned);
  if (grouped === null) return null;
  const sign = options.signed === true ? figure.sign : figure.direction === 'down' ? '−' : '';
  return { text: `${sign}$${grouped}`, figure };
}

/**
 * Percent to one decimal, always signed — an unsigned change is ambiguous.
 *
 * Rounds half away from zero rather than using `Math.round`, which rounds
 * halves toward positive infinity: that would send −31.65 to −31.6 while
 * +31.65 goes to +31.7, quietly rounding losses toward zero and gains away
 * from it. A drawdown figure that is optimistic by a tenth is still optimistic.
 */
export function formatPercent(value: number): FormattedUsd | null {
  if (!Number.isFinite(value)) return null;
  const scaled = Math.round(Math.abs(value) * 10) / 10;
  const fixed = `${value < 0 && scaled !== 0 ? '-' : ''}${scaled.toFixed(1)}`;
  const figure = signedFigure(fixed);
  if (figure === null) return null;
  return { text: `${figure.sign}${figure.magnitude}%`, figure };
}

/**
 * Quantities keep every digit the venue reported.
 *
 * A crypto balance carries up to eight decimals and rounding one for display
 * makes a holdings table disagree with the ledger it came from.
 */
export function formatQuantity(value: string, fractionDigits = 8): string | null {
  const aligned = alignDecimal(value, fractionDigits);
  return aligned === null ? null : groupDigits(aligned);
}
