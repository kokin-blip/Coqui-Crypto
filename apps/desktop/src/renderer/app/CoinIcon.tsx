const COINS = new Set(['BTC', 'ETH', 'DOGE', 'ADA', 'LINK']);

/** Local SVGs from the user-supplied Figma pack; symbols never join datasets. */
export function CoinIcon({ symbol }: { readonly symbol: string }): React.JSX.Element {
  return COINS.has(symbol) ? <img className="terminal-coin-icon" src={new URL(`../coins/${symbol}.svg`, import.meta.url).href} alt="" />
    : <span className="terminal-coin-fallback" aria-hidden="true">{symbol.slice(0, 1)}</span>;
}
