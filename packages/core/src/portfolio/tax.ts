import { Decimal } from 'decimal.js';
import { decimal, type Disposal, type UsdAmount } from '../types/index.js';

export interface TaxSummary {
  ytdRealizedUsd: UsdAmount;
  allTimeRealizedUsd: UsdAmount;
  shortTermRealizedUsd: UsdAmount;
  longTermRealizedUsd: UsdAmount;
  ytdShortTermUsd: UsdAmount;
  ytdLongTermUsd: UsdAmount;
  disposalCount: number;
}

function startOfUtcYear(now: number): number {
  return Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
}

/** Summarize realized P&L using an explicit timestamp and exact decimal totals. */
export function summarizeDisposals(disposals: readonly Disposal[], now: number): TaxSummary {
  const yearStart = startOfUtcYear(now);
  let allTime = new Decimal(0);
  let shortTerm = new Decimal(0);
  let longTerm = new Decimal(0);
  let ytdShort = new Decimal(0);
  let ytdLong = new Decimal(0);
  for (const disposal of disposals) {
    const pnl = new Decimal(disposal.realizedPnlUsd);
    allTime = allTime.add(pnl);
    if (disposal.longTerm) longTerm = longTerm.add(pnl);
    else shortTerm = shortTerm.add(pnl);
    if (disposal.disposedAt >= yearStart) {
      if (disposal.longTerm) ytdLong = ytdLong.add(pnl);
      else ytdShort = ytdShort.add(pnl);
    }
  }
  return {
    ytdRealizedUsd: decimal(ytdShort.add(ytdLong).toFixed()),
    allTimeRealizedUsd: decimal(allTime.toFixed()),
    shortTermRealizedUsd: decimal(shortTerm.toFixed()),
    longTermRealizedUsd: decimal(longTerm.toFixed()),
    ytdShortTermUsd: decimal(ytdShort.toFixed()),
    ytdLongTermUsd: decimal(ytdLong.toFixed()),
    disposalCount: disposals.length,
  };
}

/** Return UTC calendar years with at least one disposal, newest first. */
export function disposalYears(disposals: readonly Disposal[]): number[] {
  const years = new Set<number>();
  for (const disposal of disposals) years.add(new Date(disposal.disposedAt).getUTCFullYear());
  return [...years].sort((left, right) => right - left);
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Render an accountant-friendly, RFC-4180-safe disposal CSV. */
export function disposalsToCsv(disposals: readonly Disposal[], year?: number): string {
  const rows = disposals
    .filter(
      (disposal) =>
        year === undefined || new Date(disposal.disposedAt).getUTCFullYear() === year,
    )
    .sort((left, right) => left.disposedAt - right.disposedAt);
  const lines = [
    [
      'Asset',
      'Symbol',
      'Quantity',
      'Date Sold',
      'Proceeds (USD)',
      'Cost Basis (USD)',
      'Gain/Loss (USD)',
      'Term',
      'Method',
      'Source',
    ].join(','),
  ];
  for (const disposal of rows) {
    lines.push(
      [
        csvCell(disposal.asset.name),
        csvCell(disposal.asset.symbol),
        csvCell(disposal.quantity),
        csvCell(new Date(disposal.disposedAt).toISOString().slice(0, 10)),
        csvCell(new Decimal(disposal.proceedsUsd).toFixed(2)),
        csvCell(new Decimal(disposal.costBasisUsd).toFixed(2)),
        csvCell(new Decimal(disposal.realizedPnlUsd).toFixed(2)),
        csvCell(disposal.longTerm ? 'Long' : 'Short'),
        csvCell(disposal.method),
        csvCell(disposal.source),
      ].join(','),
    );
  }
  return lines.join('\n');
}
