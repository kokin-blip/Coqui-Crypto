# Security boundaries

Coqui is a local-first portfolio, research, and paper-trading application. It
has no hosted account service and its production code has no live venue order
submission path.

## Credentials and connections

- Coinbase API credentials and Robinhood Crypto API/private-key pairs are stored
  only in the operating-system credential store. SQLite contains a fingerprint
  and scoped secret reference, never secret material.
- A secret identity includes profile, connection, provider, and credential type.
  Reads and deletion verify connection ownership. Profile duplication copies no
  credential and excludes encrypted Advisor conversation, message, and audit
  history.
- Electron main owns credential-file selection and reading. The renderer receives
  only connection status, masked identity, capabilities, and evidence timestamps.
- Legacy secret identities migrate on first access by writing the new entry,
  reading it back for exact verification, and only then removing the old entry.
- Disconnect removes the selected connection's current secret. Immutable account
  and portfolio snapshots remain as historical evidence.

Coinbase connections reject trade or transfer permission. The Robinhood Crypto
adapter exposes bounded authenticated reads and deliberately exports no real
order-placement function. Coinbase and Robinhood paper venues are deterministic
simulators. Live execution remains compile-time unreachable.

## Process and authority boundaries

The sandboxed renderer has no Node.js access and no production network access.
It uses an allowlisted preload API with schema validation in both directions.
Provider HTTP, SQLite, OS credential access, and native file reads stay in main.
Production content security policy keeps `connect-src 'none'`; development adds
only the local Vite origin and its local HMR WebSocket.

Advisor evidence is assembled in main from allowlisted, profile-scoped stored
facts. Cloud providers may rephrase that pack and fall back to a deterministic
local explanation on failure. Advisor navigation is allowlisted and has no
credential, configuration, research-promotion, routing, or execution authority.

Research workers receive immutable bounded definitions and snapshots, not
secret stores, profile repositories, OMS, routes, or execution services. Local
market-event fixtures are context-only and cannot influence targets, risk,
routing, or execution. Desktop and headless hosts share fenced paper authority;
only the assigned local host can reach simulated placement.

## Evidence and diagnostics

Complex evidence is canonicalized and content-hashed. Immutable evidence tables
reject update/delete operations. Secret-bearing request payloads are never used
for deprecation telemetry: only the stable IPC channel name is logged. Errors are
sanitized before crossing process boundaries, and unavailable evidence is shown
as unavailable rather than reconstructed.

Release verification includes:

```text
pnpm verify
pnpm exec vitest run tests/secret-leak-sweep.test.ts tests/secrets.test.ts
pnpm exec vitest run tests/storage-migrations.test.ts
pnpm smoke
```

These controls reduce accidental disclosure and authority confusion; they do not
replace operating-system security. Anyone who can read an unlocked user's
credential store or application-support directory should be treated as having
local-user access.
