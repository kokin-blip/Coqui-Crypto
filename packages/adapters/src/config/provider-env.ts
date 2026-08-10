export const COINGECKO_DEMO_ENV = 'COINGECKO_DEMO_API_KEY';
export const COINMARKETCAP_ENV = 'COINMARKETCAP_API_KEY';

export interface ProviderApiKeys {
  readonly coinGeckoDemo: string | null;
  readonly coinMarketCap: string | null;
}

function optionalSecret(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/** Read development credentials without logging, formatting, or validating them remotely. */
export function readProviderApiKeys(
  environment: Readonly<Record<string, string | undefined>>,
): ProviderApiKeys {
  return {
    coinGeckoDemo: optionalSecret(environment[COINGECKO_DEMO_ENV]),
    coinMarketCap: optionalSecret(environment[COINMARKETCAP_ENV]),
  };
}

/** Return presence only; safe for diagnostics and renderer-facing status. */
export function providerApiKeyStatus(keys: ProviderApiKeys): Readonly<{
  coinGeckoDemo: boolean;
  coinMarketCap: boolean;
}> {
  return {
    coinGeckoDemo: keys.coinGeckoDemo !== null,
    coinMarketCap: keys.coinMarketCap !== null,
  };
}
