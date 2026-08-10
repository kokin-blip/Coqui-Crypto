# Coinbase rate-limit decision — 2026-08-01

Phase 2 uses conservative client-side limits rather than treating a published
maximum as a target.

Official sources checked:

- Coinbase App: 10,000 requests per hour by default for each API key or
  OAuth-authenticated user.
  <https://docs.cdp.coinbase.com/coinbase-app/api-architecture/rate-limiting>
- Coinbase Exchange REST: public endpoints allow 10 requests/second per IP
  with bursts to 15; private endpoints allow 15/second per profile.
  <https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits>
- Advanced Trade uses `https://api.coinbase.com/api/v3/brokerage/{resource}`.
  <https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api>

Decision:

- `api.coinbase.com`: 2 requests/second. Continuous use is 7,200/hour, leaving
  28% headroom below the stricter Coinbase App hourly ceiling.
- `api.exchange.coinbase.com`: 8 requests/second, below the 10/second public
  Exchange ceiling. This host is retained only for migrated read-only sources.
- Unknown hosts: 60 requests/minute until their official policy is verified.

Implemented in Phase 2: the HTTP client honors `Retry-After` up to 60 seconds,
degrades to a typed failure rather than throw, counts every retry against the
destination limiter, and never automatically retries a potentially mutating
`POST` request.
