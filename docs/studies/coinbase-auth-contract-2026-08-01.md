# Coinbase App authentication contract — 2026-08-01

Phase 2 rechecked the predecessor's Advanced Trade authentication and permission
probe against current Coinbase documentation.

Official sources checked:

- Coinbase App currently requires ECDSA P-256 / ES256 keys and explicitly says
  Ed25519 keys are not supported for Coinbase App APIs. Request-bound JWTs carry
  `sub`, `iss`, `nbf`, `exp`, and `uri`; include `kid` and a nonce in the header;
  expire after two minutes; and must be regenerated for each unique request.
  <https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication>
- `GET /api/v3/brokerage/key_permissions` reports `can_view`, `can_trade`, and
  `can_transfer`, with transfer meaning deposit/withdrawal capability.
  <https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/data-api/get-api-key-permissions>
- The Advanced Trade endpoint table identifies account reads and the permission
  probe as View operations while order creation requires Trade and fund movement
  requires Transfer.
  <https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api>

Decision:

- Accept only ECDSA P-256 credentials for Coinbase App connections. The
  predecessor's Ed25519 support matched an older SDK contract but conflicts with
  the current product-specific authentication guide.
- Detect the key algorithm from parsed key metadata. Do not create a throwaway
  signature merely to discover `alg`.
- Expose an authenticated GET-only client. It signs each network attempt with a
  fresh request-bound JWT and refuses non-HTTPS, non-Coinbase, credentialed,
  port-qualified, fragmented, or non-GET destinations before adding a bearer
  token.
- The connect-time probe fails closed unless Coinbase explicitly reports
  `can_view: true`, `can_trade: false`, and `can_transfer: false`, then proves the
  key can read the accounts endpoint. Missing permission flags are not treated
  as false.
