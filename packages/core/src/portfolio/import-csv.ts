import { Decimal } from 'decimal.js';
import {
  decimal,
  type AssetQuantity,
  type InstrumentIdentity,
  type UsdAmount,
} from '../types/index.js';

export type CsvTradeAction = 'buy' | 'sell';

export interface CsvTradeRow {
  rowNumber: number;
  action: CsvTradeAction;
  instrument: InstrumentIdentity;
  /** Original display symbol retained only for review. */
  symbol: string;
  quantity: AssetQuantity;
  usd: UsdAmount;
  dateMs: number;
}

export interface CsvImportSkip {
  rowNumber: number;
  reason: string;
}

export interface CsvImportParseResult {
  trades: CsvTradeRow[];
  skipped: CsvImportSkip[];
}

export type CsvInstrumentResolver = (
  displaySymbol: string,
) => InstrumentIdentity | null;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (character !== '\r') {
      cell += character;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((candidate) => candidate.some((value) => value.trim().length > 0));
}

function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function decimalCell(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/[$,\s]/g, '');
  try {
    const parsed = new Decimal(normalized);
    return parsed.isFinite() ? parsed.toFixed() : null;
  } catch {
    return null;
  }
}

function first(row: Readonly<Record<string, string>>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function actionFrom(value: string | undefined): CsvTradeAction | null {
  const normalized = (value ?? '').toLowerCase();
  if (/\bbuy\b|purchase|acquisition/.test(normalized)) return 'buy';
  if (/\bsell\b|sold|disposal/.test(normalized)) return 'sell';
  return null;
}

/**
 * Parse reviewable buy/sell rows. A row is accepted only after its display
 * symbol resolves to an explicit canonical instrument; this function creates no lots.
 */
export function parsePortfolioCsv(
  text: string,
  resolveInstrument: CsvInstrumentResolver,
): CsvImportParseResult {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { trades: [], skipped: [{ rowNumber: 1, reason: 'CSV has no data rows.' }] };
  }
  const headers = rows[0]!.map(headerKey);
  const trades: CsvTradeRow[] = [];
  const skipped: CsvImportSkip[] = [];

  for (let index = 1; index < rows.length; index++) {
    const raw = rows[index]!;
    const row: Record<string, string> = {};
    headers.forEach((header, column) => {
      row[header] = raw[column] ?? '';
    });
    const rowNumber = index + 1;
    const action = actionFrom(first(row, ['type', 'transactiontype', 'side', 'action']));
    const symbol = first(row, [
      'symbol',
      'asset',
      'currency',
      'baseasset',
      'assetticker',
    ])?.toUpperCase();
    const quantityText = decimalCell(
      first(row, ['quantity', 'amount', 'quantitytransacted', 'qty', 'units']),
    );
    const usdText = decimalCell(
      first(row, [
        'totalusd',
        'total',
        'proceedsusd',
        'proceeds',
        'costusd',
        'cost',
        'subtotal',
        'valueusd',
        'usd',
      ]),
    );
    const dateRaw = first(row, ['date', 'time', 'timestamp', 'createdat', 'transactedat']);
    const dateMs = dateRaw ? Date.parse(dateRaw) : Number.NaN;

    if (!action) {
      skipped.push({
        rowNumber,
        reason: 'Unsupported row type (only buy/sell rows are imported).',
      });
    } else if (!symbol) {
      skipped.push({ rowNumber, reason: 'Missing asset symbol.' });
    } else if (quantityText === null || new Decimal(quantityText).lte(0)) {
      skipped.push({ rowNumber, reason: 'Missing or invalid quantity.' });
    } else if (usdText === null || new Decimal(usdText).lt(0)) {
      skipped.push({ rowNumber, reason: 'Missing or invalid USD total/proceeds.' });
    } else if (!Number.isFinite(dateMs)) {
      skipped.push({ rowNumber, reason: 'Missing or invalid date.' });
    } else {
      const instrument = resolveInstrument(symbol);
      if (!instrument) {
        skipped.push({
          rowNumber,
          reason: `Unresolved canonical instrument for ${symbol}.`,
        });
      } else {
        trades.push({
          rowNumber,
          action,
          instrument,
          symbol,
          quantity: decimal(quantityText),
          usd: decimal(usdText),
          dateMs,
        });
      }
    }
  }

  trades.sort((left, right) => left.dateMs - right.dateMs || left.rowNumber - right.rowNumber);
  return { trades, skipped };
}
