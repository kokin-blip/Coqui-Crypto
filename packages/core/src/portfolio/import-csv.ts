import { Decimal } from 'decimal.js';
import { sha256Hex } from '../crypto/sha256.js';
import { instrumentKey } from '../types/index.js';
import {
  decimal,
  type AssetQuantity,
  type AssetRef,
  type CostBasisMethod,
  type Disposal,
  type InstrumentIdentity,
  type TaxLot,
  type UsdAmount,
} from '../types/index.js';
import { disposeLots } from './costbasis.js';

/**
 * A reward is an acquisition, not income the ledger can ignore.
 *
 * Staking and interest arrive with a fair market value at receipt, and that
 * value *is* the cost basis. Dropping these rows — as the earlier port did —
 * leaves the asset in the wallet with no lot behind it, which later surfaces as
 * a reconciliation exception the user cannot honestly resolve, or worse, as a
 * disposal with no basis.
 */
export type CsvTradeAction = 'buy' | 'sell' | 'reward';

export interface CsvTradeRow {
  rowNumber: number;
  action: CsvTradeAction;
  instrument: InstrumentIdentity;
  /** Original display symbol retained only for review. */
  symbol: string;
  quantity: AssetQuantity;
  usd: UsdAmount;
  dateMs: number;
  /**
   * Content fingerprint — `csv:<action>:<symbol>:<qty>:<usd>:<dateMs>`, with a
   * `#n` suffix for genuinely repeated identical rows.
   *
   * This is what makes re-importing an overlapping export safe. Two identical
   * legitimate trades on the same day stay distinct (`#2`, `#3`), while the same
   * file imported twice reproduces the same fingerprints and is skipped.
   */
  fingerprint: string;
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

/**
 * Match a header by prefix.
 *
 * Coinbase names its money column `Total (inclusive of fees and/or spread)`,
 * which normalises to `totalinclusiveoffeesandorspread` and matches nothing on
 * an exact list. Prefix matching is confined to the USD column, where the
 * candidates are distinctive enough that a false match is not plausible.
 */
function firstByPrefix(
  row: Readonly<Record<string, string>>,
  prefixes: readonly string[],
): string | undefined {
  for (const prefix of prefixes) {
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith(prefix) && value.trim().length > 0) return value.trim();
    }
  }
  return undefined;
}

function actionFrom(value: string | undefined): CsvTradeAction | null {
  const normalized = (value ?? '').toLowerCase();
  // Reward first: "Staking income" would otherwise never match, and Coinbase's
  // "Learning reward" contains neither buy nor sell.
  if (/reward|staking|interest|\bearn\b/.test(normalized)) return 'reward';
  if (/\bbuy\b|purchase|acquisition/.test(normalized)) return 'buy';
  if (/\bsell\b|sold|disposal/.test(normalized)) return 'sell';
  return null;
}

/**
 * Rows that move an asset without changing its basis.
 *
 * Named explicitly so the skip reason can say *why* rather than "unsupported".
 * A user who sees their transfers silently dropped assumes the import failed.
 */
function isTransferLike(value: string | undefined): boolean {
  return /send|receive|transfer|deposit|withdraw|convert/.test((value ?? '').toLowerCase());
}

const ACTION_HEADERS = ['type', 'transactiontype', 'side', 'action'] as const;
const SYMBOL_HEADERS = ['symbol', 'asset', 'currency', 'baseasset', 'assetticker'] as const;
const QUANTITY_HEADERS = ['quantity', 'amount', 'quantitytransacted', 'qty', 'units'] as const;
const USD_HEADERS = [
  'totalusd', 'total', 'proceedsusd', 'proceeds', 'costusd', 'cost', 'subtotal', 'valueusd', 'usd',
] as const;
const PRICE_HEADERS = ['spotpriceattransaction', 'priceattransaction', 'price'] as const;
const DATE_HEADERS = ['date', 'time', 'timestamp', 'createdat', 'transactedat'] as const;

/**
 * Find the header row past any preamble.
 *
 * Real exports — Coinbase's transaction report especially — put title and
 * account lines above the header, so treating row 1 as the header rejects the
 * whole file. The header is the first row carrying a recognisable
 * type + asset + quantity trio.
 */
function findHeaderRow(rows: readonly string[][]): number {
  const limit = Math.min(rows.length, 30);
  for (let index = 0; index < limit; index += 1) {
    const keys = rows[index]!.map(headerKey);
    const has = (candidates: readonly string[]): boolean =>
      candidates.some((candidate) => keys.includes(candidate));
    if (has(ACTION_HEADERS) && has(SYMBOL_HEADERS) && has(QUANTITY_HEADERS)) return index;
  }
  return -1;
}

/**
 * Parse reviewable buy/sell rows. A row is accepted only after its display
 * symbol resolves to an explicit canonical instrument; this function creates no lots.
 */
export function parsePortfolioCsv(
  text: string,
  resolveInstrument: CsvInstrumentResolver,
): CsvImportParseResult {
  // A BOM would attach itself to the first header cell and make it unmatchable.
  const rows = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const headerIndex = findHeaderRow(rows);
  if (headerIndex === -1) {
    return {
      trades: [],
      skipped: [{
        rowNumber: 1,
        reason: 'Could not find a header row with type/asset/quantity columns.',
      }],
    };
  }
  if (rows.length <= headerIndex + 1) {
    return { trades: [], skipped: [{ rowNumber: headerIndex + 1, reason: 'CSV has no data rows.' }] };
  }
  const headers = rows[headerIndex]!.map(headerKey);
  const trades: CsvTradeRow[] = [];
  const skipped: CsvImportSkip[] = [];

  for (let index = headerIndex + 1; index < rows.length; index++) {
    const raw = rows[index]!;
    const row: Record<string, string> = {};
    headers.forEach((header, column) => {
      row[header] = raw[column] ?? '';
    });
    const rowNumber = index + 1;
    const typeRaw = first(row, ACTION_HEADERS);
    const action = actionFrom(typeRaw);
    const symbol = first(row, SYMBOL_HEADERS)?.toUpperCase();
    const quantityText = decimalCell(first(row, QUANTITY_HEADERS));
    let usdText = decimalCell(first(row, USD_HEADERS) ?? firstByPrefix(row, USD_HEADERS));
    if (usdText === null && quantityText !== null) {
      // Coinbase reward rows carry a spot price and no total. Multiplied in
      // Decimal, never float: this figure becomes a cost basis (invariant 11).
      const priceText = decimalCell(first(row, PRICE_HEADERS));
      if (priceText !== null) {
        usdText = new Decimal(priceText).mul(quantityText).toFixed();
      }
    }
    const dateRaw = first(row, DATE_HEADERS);
    const dateMs = dateRaw ? Date.parse(dateRaw) : Number.NaN;

    if (!action) {
      skipped.push({
        rowNumber,
        reason: isTransferLike(typeRaw)
          ? `Transfers and converts are not imported (${typeRaw ?? 'unknown'}) — only buys, sells and rewards.`
          : 'Unsupported row type (only buy, sell and reward rows are imported).',
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
          fingerprint: '',
        });
      }
    }
  }

  // Fingerprints are assigned in *file* order, before the date sort, so that a
  // re-import of the same file reproduces them exactly while two genuinely
  // identical rows stay distinguishable.
  const seenCounts = new Map<string, number>();
  const fingerprinted = trades.map((trade) => {
    const base = `csv:${trade.action}:${trade.symbol}:${trade.quantity}:${trade.usd}:${trade.dateMs}`;
    const count = (seenCounts.get(base) ?? 0) + 1;
    seenCounts.set(base, count);
    return { ...trade, fingerprint: count === 1 ? base : `${base}#${count}` };
  });

  fingerprinted.sort(
    (left, right) => left.dateMs - right.dateMs || left.rowNumber - right.rowNumber,
  );
  return { trades: fingerprinted, skipped };
}

export interface CsvImportPlan {
  /** The open-lot book to persist: existing lots adjusted by sells, plus new lots. */
  readonly updatedOpenLots: readonly TaxLot[];
  /** How many lots the plan adds. Buys and rewards both create one. */
  readonly newLotCount: number;
  readonly newDisposals: readonly Disposal[];
  /** Lots fully consumed by imported sells. */
  readonly deletedLotIds: readonly string[];
  /** Fingerprints imported this run — the caller appends these to its ledger. */
  readonly importedFingerprints: readonly string[];
  readonly skipped: readonly CsvImportSkip[];
}

export type CsvAssetResolver = (instrument: InstrumentIdentity, symbol: string) => AssetRef | null;

/**
 * Turn parsed rows into a lot and disposal plan. Pure: it persists nothing.
 *
 * Rows whose fingerprint is already known are skipped, so re-importing the same
 * or an overlapping export never duplicates a lot or a disposal. That matters
 * more than it sounds: a duplicated lot is a fabricated cost basis, which is the
 * same class of defect invariant 12 forbids reconciliation from committing.
 *
 * A sell that exceeds the open lots imports **the covered portion only** and
 * reports the shortfall. The alternative — inventing a lot to cover it — is
 * exactly what invariant 12 forbids.
 */
export function buildCsvImportPlan(
  trades: readonly CsvTradeRow[],
  openLots: readonly TaxLot[],
  seenFingerprints: ReadonlySet<string>,
  costBasisMethod: CostBasisMethod,
  resolveAsset: CsvAssetResolver,
): CsvImportPlan {
  const skipped: CsvImportSkip[] = [];
  const newDisposals: Disposal[] = [];
  const deletedLotIds = new Set<string>();
  const importedFingerprints: string[] = [];
  let lots: readonly TaxLot[] = [...openLots];
  let newLotCount = 0;

  for (const row of trades) {
    if (seenFingerprints.has(row.fingerprint)) {
      skipped.push({
        rowNumber: row.rowNumber,
        reason: 'Already imported in a previous run (duplicate skipped).',
      });
      continue;
    }
    const asset = resolveAsset(row.instrument, row.symbol);
    if (asset === null) {
      skipped.push({
        rowNumber: row.rowNumber,
        reason: `Unknown or unsupported asset symbol: ${row.symbol}.`,
      });
      continue;
    }

    if (row.action === 'buy' || row.action === 'reward') {
      lots = [...lots, {
        // Derived from the fingerprint rather than random, so `core` stays pure
        // and a re-run produces the same id instead of a second lot.
        id: sha256Hex(row.fingerprint),
        asset,
        quantity: row.quantity,
        remaining: row.quantity,
        // A reward's basis is its fair market value at receipt, which is the
        // USD figure the export carries. Zero would be a fabricated basis.
        costUsd: row.usd,
        acquiredAt: row.dateMs,
        source: 'manual',
        externalId: row.fingerprint,
      }];
      newLotCount += 1;
      importedFingerprints.push(row.fingerprint);
      continue;
    }

    const result = disposeLots(
      lots, row.instrument, row.quantity, row.usd, costBasisMethod, row.dateMs,
    );
    if (new Decimal(result.shortfall).gt(0)) {
      skipped.push({
        rowNumber: row.rowNumber,
        reason: `Sell exceeded open ${row.symbol} lots by ${result.shortfall}. Imported the covered portion only.`,
      });
    }
    const key = instrumentKey(row.instrument);
    const before = new Set(
      lots.filter((lot) => instrumentKey(lot.asset.instrument) === key).map((lot) => lot.id),
    );
    for (const lot of result.updatedLots) before.delete(lot.id);
    for (const id of before) deletedLotIds.add(id);

    lots = result.updatedLots;
    newDisposals.push(
      ...result.disposals.map((disposal, index) => ({
        ...disposal,
        id: `${row.fingerprint}:${index}`,
      })),
    );
    if (result.disposals.length > 0) importedFingerprints.push(row.fingerprint);
  }

  return Object.freeze({
    updatedOpenLots: lots,
    newLotCount,
    newDisposals: Object.freeze(newDisposals),
    deletedLotIds: Object.freeze([...deletedLotIds]),
    importedFingerprints: Object.freeze(importedFingerprints),
    skipped: Object.freeze(skipped),
  });
}
