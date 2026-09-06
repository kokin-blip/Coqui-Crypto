import {
  executionRouteHash,
  sha256Hex,
  type ExecutionRouteV1,
  type PaperVenueAdapter,
  type PaperVenuePlacement,
  type PaperVenueProvider,
} from '@coqui/core';

function deterministicPaperAdapter(provider: PaperVenueProvider): PaperVenueAdapter {
  return Object.freeze({
    provider,
    place(route: ExecutionRouteV1): PaperVenuePlacement {
      if (route.provider !== provider || route.instrument.venue !== provider ||
          executionRouteHash(route) !== route.contentHash) {
        return Object.freeze({
          accepted: false, providerOrderId: null, reasonCode: 'venue_refused',
          idempotencyKey: route.idempotencyKey,
        });
      }
      return Object.freeze({
        accepted: true,
        providerOrderId: sha256Hex(`simulated-paper-order:${provider}:${route.idempotencyKey}`),
        reasonCode: 'accepted', idempotencyKey: route.idempotencyKey,
      });
    },
  });
}

export function createCoinbasePaperVenueAdapter(): PaperVenueAdapter {
  return deterministicPaperAdapter('coinbase');
}

/** Simulator only: this constructor accepts no credentials or network client. */
export function createRobinhoodPaperVenueAdapter(): PaperVenueAdapter {
  return deterministicPaperAdapter('robinhood_crypto');
}
