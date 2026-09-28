import type { UniverseAlpacaAsset, UniverseLiquidity } from '@coqui/core';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid_alpaca_universe_response');
  return value as Record<string, unknown>;
}
function decimal(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      !Number.isFinite(Number(value)) || Number(value) <= 0) throw new Error('invalid_alpaca_universe_decimal');
  return String(value);
}
export function parseAlpacaUniverseAssets(value: unknown): UniverseAlpacaAsset[] {
  if (!Array.isArray(value)) throw new Error('invalid_alpaca_universe_catalog');
  const ids = new Set<string>(), symbols = new Set<string>();
  return value.map((item) => {
    const row = record(item);
    if (typeof row['id'] !== 'string' || !row['id'] || row['class'] !== 'crypto' ||
        typeof row['symbol'] !== 'string' || !/^[A-Z0-9._-]+\/[A-Z0-9._-]+$/u.test(row['symbol']) ||
        typeof row['status'] !== 'string' || typeof row['tradable'] !== 'boolean' ||
        ids.has(row['id']) || symbols.has(row['symbol'])) throw new Error('invalid_alpaca_universe_asset');
    ids.add(row['id']); symbols.add(row['symbol']);
    return { id: row['id'], symbol: row['symbol'], class: 'crypto', status: row['status'], tradable: row['tradable'],
      min_order_size: decimal(row['min_order_size']), min_trade_increment: decimal(row['min_trade_increment']),
      price_increment: decimal(row['price_increment']) };
  }).sort((a, b) => a.symbol.localeCompare(b.symbol));
}
export function alpacaUniverseSymbols(symbols: readonly string[]): string {
  if (symbols.length === 0 || symbols.length > 100 || new Set(symbols).size !== symbols.length ||
      symbols.some((symbol) => !/^[A-Z0-9._-]+\/USD$/u.test(symbol))) throw new Error('invalid_alpaca_universe_symbols');
  return encodeURIComponent([...symbols].sort().join(','));
}
export function parseAlpacaUniverseLiquidity(quotes: unknown, books: unknown, symbol: string,
  capturedAtMs: number): UniverseLiquidity {
  const quote = record(record(record(quotes)['quotes'])[symbol]);
  const book = record(record(record(books)['orderbooks'])[symbol]);
  const time = (value: unknown) => {
    if (typeof value !== 'string' || !Number.isSafeInteger(Date.parse(value))) throw new Error('invalid_alpaca_universe_time');
    return Date.parse(value);
  };
  const levels = (value: unknown) => {
    if (!Array.isArray(value) || value.length > 1000) throw new Error('invalid_alpaca_universe_book');
    return value.map((v) => { const r = record(v); return { price: decimal(r['p']), size: decimal(r['s']) }; });
  };
  return { bid: decimal(quote['bp']), ask: decimal(quote['ap']), quoteAtMs: time(quote['t']),
    bookAtMs: time(book['t']), capturedAtMs, bids: levels(book['b']), asks: levels(book['a']) };
}
