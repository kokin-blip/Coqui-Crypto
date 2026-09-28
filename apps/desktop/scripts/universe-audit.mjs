// Run under Electron main only. This audit reads the connected account but has no scheduler or order path.
import { app } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { setTimeout, clearTimeout } from 'node:timers';
import { createOsKeyringSecretStore, createRateLimiterRegistry, createHttpClient, createAlpacaPaperClient,
  fetchCoinbaseUniverseProducts, fetchCoinbaseQuote, fetchCoinbaseBook, fetchCoinbaseProduct,
  parseAlpacaUniverseAssets, parseAlpacaUniverseLiquidity } from '../../../packages/adapters/dist/index.js';
import { evaluateUniverseAsset, mapUniverseProducts, universeHash, WIDER_UNIVERSE_POLICY,
  UNIVERSE_DAY, instrumentKey } from '../../../packages/core/dist/index.js';
import { getSetting } from '../../../packages/storage/dist/index.js';
import { createHistoricalCoinbaseCandleSource } from '../dist/main/coinbase-candle-source.js';
import { widerUniverseRuntimeSourceHash } from '../dist/main/wider-universe-runtime.js';

const option = (name) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
let database;
const deadline = setTimeout(() => { console.error('Read-only universe audit timed out.'); app.exit(1); }, 240_000);
void app.whenReady().then(async () => {
try {
  if (process.type !== 'browser' || !option('database') || !option('output')) throw new Error('main_audit_arguments_required');
  const profileId = option('profile') ?? 'main';
  database = new DatabaseSync(option('database'), { readOnly: true });
  const keyring = createOsKeyringSecretStore();
  const secrets = { read: (...args) => keyring.read(...args),
    write: async () => ({ ok: false, code: 'unavailable', message: 'Audit cannot mutate credentials.' }),
    remove: async () => ({ ok: false, code: 'unavailable', message: 'Audit cannot mutate credentials.' }) };
  const rateLimiters = createRateLimiterRegistry(), http = createHttpClient({ rateLimiters });
  const source = createHistoricalCoinbaseCandleSource({ database, profileId, publicHttp: http, rateLimiters,
    nowMs: () => Date.now(), secrets });
  const coinbase = await fetchCoinbaseUniverseProducts(http);
  if (!coinbase.ok) throw new Error('coinbase_catalog_unavailable');
  let catalogObservedAtMs = Date.now();
  const coinbaseCatalogObservedAtMs = catalogObservedAtMs;
  console.log(JSON.stringify({ status: 'coinbase_catalog_read', products: coinbase.data.length }));
  let client = null, assets = [], accountReady = null, connectionReason = null;
  try {
    const stored = await secrets.read('alpaca-paper-credentials', profileId);
    if (!stored.ok || !stored.value) throw new Error('unavailable');
    client = createAlpacaPaperClient(JSON.parse(stored.value));
    const account = await client.account();
    accountReady = account.id === getSetting('alpaca.paper.account.id', database) &&
      ['ACTIVE', 'PAPER_ONLY'].includes(account.status) && account.currency === 'USD' && !account.account_blocked && !account.trading_blocked;
    assets = await client.cryptoAssets();
  } catch { client = null; connectionReason = 'connected_alpaca_catalog_or_account_unavailable'; }
  catalogObservedAtMs = Date.now();
  const mappings = mapUniverseProducts(coinbase.data, assets), decisions = [];
  console.log(JSON.stringify({ status: 'account_catalog_checked', mapped: mappings.filter((m) => m.mapping).length, connectionReason }));
  for (const m of option('catalog-only') === 'true' ? [] : mappings) {
    const assetId = instrumentKey(m.product.instrument);
    if (!m.mapping || !client) {
      decisions.push({ assetId, eligible: false, reasons: [connectionReason ?? m.reason],
        historicalEligibility: 'not_established' }); continue;
    }
    let auth;
    try {
      const bars = await source.dailyBars(m.product.instrument, 400, Date.now());
      auth = await source.authenticatedClient();
      const symbol = m.mapping.alpacaSymbol;
      const [account, currentAssetRaw, quotes, books, quote, book, product] = await Promise.all([
        client.account(), client.asset(symbol), client.latestCryptoQuotes([symbol]), client.latestCryptoOrderbooks([symbol]),
        auth ? fetchCoinbaseQuote(auth, m.product.instrument.productId, Date.now()) : null,
        auth ? fetchCoinbaseBook(auth, m.product.instrument.productId, Date.now()) : null,
        auth ? fetchCoinbaseProduct(auth, m.product.instrument.productId) : null ]);
      const atMs = Date.now();
      const evidence = { product: m.product, asset: m.asset, mapping: m.mapping, mappingReason: m.reason,
        catalogObservedAtMs, accountObservedAtMs: atMs,
        accountReady: accountReady && account.id === getSetting('alpaca.paper.account.id', database) &&
          ['ACTIVE', 'PAPER_ONLY'].includes(account.status) && account.currency === 'USD' && !account.trading_blocked && !account.account_blocked,
        bars: bars.ok ? bars.bars : [], listedAtMs: null,
        currentAsset: parseAlpacaUniverseAssets([currentAssetRaw])[0], rulesObservedAtMs: atMs,
        currentProduct: product ? { ...m.product, ...product, minMarketFunds: product.quoteMinSize } : null,
        coinbase: quote && book ? { bid: quote.bid, ask: quote.ask, quoteAtMs: quote.observedAtMs,
          bookAtMs: book.observedAtMs, capturedAtMs: atMs, bids: book.bids, asks: book.asks } : null,
        alpaca: parseAlpacaUniverseLiquidity(quotes, books, symbol, atMs) };
      const result = evaluateUniverseAsset(evidence, atMs);
      decisions.push({ ...result, mapping: m.mapping,
        currentMarketChecksPassed: result.reasons.filter((r) => r !== 'catalog_asof').length === 0,
        historicalEligibility: 'not_established', evidence });
    } catch { decisions.push({ assetId, eligible: false, reasons: ['asset_acquisition_failed'], historicalEligibility: 'not_established' }); }
    finally { auth?.destroy(); }
  }
  const material = { schemaVersion: 1, mode: 'read_only_current_inventory', generatedAtMs: Date.now(),
    policy: WIDER_UNIVERSE_POLICY, policyHash: universeHash(WIDER_UNIVERSE_POLICY), runtimeSourceHash: widerUniverseRuntimeSourceHash(),
    catalogObservedAtMs, coinbaseCatalogObservedAtMs, catalog: { products: coinbase.data, assets },
    earliestDailyMembershipMs: (Math.floor(catalogObservedAtMs / UNIVERSE_DAY) + 1) * UNIVERSE_DAY,
    catalogHash: universeHash({ products: coinbase.data, assets }), mappingHash: universeHash(mappings.map((m) => m.mapping)),
    datasetHash: universeHash(decisions.map((d) => [d.assetId, d.evidence?.bars ?? null])),
    coinbaseProductCount: coinbase.data.length, alpacaProductCount: assets.length, mappedProductCount: mappings.filter((m) => m.mapping).length,
    connectionReason, decisions, executionEnabled: false,
    limitation: 'A current inventory cannot establish prior-day or historical membership. This audit does not register or open a study.' };
  writeFileSync(option('output'), `${JSON.stringify({ ...material, reportHash: universeHash(material) }, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: 'audit_saved', products: decisions.length,
    mapped: material.mappedProductCount, connectionReason, reportHash: universeHash(material) }));
} catch {
  console.error('Read-only main-process universe audit unavailable; no credentials or provider payloads were printed.');
  process.exitCode = 1;
} finally { clearTimeout(deadline); database?.close(); app.exit(process.exitCode ? 1 : 0); }
});
