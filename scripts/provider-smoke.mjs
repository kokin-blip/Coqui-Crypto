import {
  createCoinGeckoDemoHttpClient,
  createCoinGeckoDemoMarketSource,
  createCoinMarketCapHttpClient,
  createCoinMarketCapMarketSource,
  createCoinPaprikaMarketSource,
  createHttpClient,
  providerApiKeyStatus,
  readProviderApiKeys,
} from '../packages/adapters/dist/index.js';
import { compareMarketProviders } from '../packages/services/dist/index.js';

const keys = readProviderApiKeys(process.env);
const configured = providerApiKeyStatus(keys);
const clients = [];
const sources = [];

if (keys.coinGeckoDemo !== null) {
  const client = createCoinGeckoDemoHttpClient(keys.coinGeckoDemo);
  clients.push(client);
  sources.push(createCoinGeckoDemoMarketSource(client));
}
if (keys.coinMarketCap !== null) {
  const client = createCoinMarketCapHttpClient(keys.coinMarketCap);
  clients.push(client);
  sources.push(createCoinMarketCapMarketSource(client));
}
const coinPaprika = createHttpClient();
clients.push(coinPaprika);
sources.push(createCoinPaprikaMarketSource(coinPaprika));

const mappings = [{
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  coingeckoId: 'bitcoin',
  coinMarketCapId: 1,
  coinPaprikaId: 'btc-bitcoin',
}];

try {
  const report = await compareMarketProviders({ sources, mappings });
  const output = {
    configured: {
      coingecko: configured.coinGeckoDemo,
      coinmarketcap: configured.coinMarketCap,
      coinpaprika: true,
    },
    providers: report.providers.map((provider) => ({
      provider: provider.provider,
      ok: provider.ok,
      status: provider.status,
      latencyMs: provider.latencyMs,
      mappedAssets: provider.mappedAssets,
      returnedAssets: provider.returnedAssets,
      coveragePct: provider.coveragePct,
    })),
    pairwisePriceDeviationBps: report.priceDeviations.map((deviation) => ({
      productId: deviation.instrument.productId,
      left: deviation.left,
      right: deviation.right,
      midpointDeviationBps: deviation.midpointDeviationBps,
    })),
  };
  console.log(JSON.stringify(output, null, 2));
  if (report.providers.some((provider) => !provider.ok)) process.exitCode = 1;
} catch {
  console.error('Provider smoke test failed without exposing remote or credential details.');
  process.exitCode = 1;
} finally {
  for (const client of clients) client.destroy();
}
