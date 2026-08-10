/** USD-pegged assets treated as cash rather than risk positions. */
export const STABLECOIN_SYMBOLS = new Set([
  'USDC',
  'USDT',
  'DAI',
  'PYUSD',
  'GUSD',
  'USDP',
  'TUSD',
  'FDUSD',
]);

export function isStablecoin(input: string | { symbol: string }): boolean {
  const symbol = typeof input === 'string' ? input : input.symbol;
  return STABLECOIN_SYMBOLS.has(symbol.trim().toUpperCase());
}
