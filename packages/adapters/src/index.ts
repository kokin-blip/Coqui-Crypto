/** External I/O adapters implementing interfaces owned by core. */
export const ADAPTERS_PACKAGE = '@coqui/adapters' as const;
export * from './bulk/index.js';
export * from './coinbase/index.js';
export * from './coingecko/index.js';
export * from './coinmarketcap/index.js';
export * from './coinpaprika/index.js';
export * from './config/index.js';
export * from './http/index.js';
export * from './market-data/index.js';
export * from './reference/index.js';
export * from './secrets/index.js';
