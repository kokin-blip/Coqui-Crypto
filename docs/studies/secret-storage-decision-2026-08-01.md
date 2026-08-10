# Secret-storage dependency decision — 2026-08-01

Phase 2 evaluated how to preserve the predecessor's OS-credential entries
without restoring the archived `keytar` package.

Sources and checks:

- Electron `safeStorage` protects application-managed ciphertext with macOS
  Keychain, Windows DPAPI, or a Linux secret service. On Linux its synchronous
  backend can degrade to `basic_text`, which applications must detect.
  <https://www.electronjs.org/docs/latest/api/safe-storage>
- `@napi-rs/keyring` exposes asynchronous native keyring operations and an
  explicitly keytar-compatible API over the maintained Rust `keyring` library.
  Its package declares prebuilt targets for supported Windows, macOS, and Linux
  architectures.
  <https://github.com/Brooooooklyn/keyring-node>
- npm registry metadata checked on 2026-08-01 reported version 1.3.0, MIT
  licensing, and an April 2026 release. `pnpm audit --prod` found no known
  vulnerabilities after installation.

Decision:

- Pin `@napi-rs/keyring` 1.3.0 and use its asynchronous keytar-compatible facade
  under `packages/adapters/src/secrets`.
- Preserve service `kokincrypto`, unsuffixed Main Wallet accounts, and
  `${key}:${walletId}` for secondary wallets. The optional CoinGecko key remains
  application-wide.
- Load the native module lazily and cache successful, missing, concurrent, and
  failed reads for the process. This prevents repeated credential-manager prompts.
- Convert every backend exception to stable typed output. Never include native
  error text, account contents, or secret material in a returned failure.
- Reject invalid scopes and empty or oversized values before calling the native
  backend. Never fall back to SQLite, files, environment variables, plaintext,
  or Electron `safeStorage` when the keyring is unavailable.
- Load-test the native facade without reading or writing credentials on Windows,
  macOS, and Linux CI. Repeat the check inside packaged Electron as soon as the
  Phase 5 packaging job exists.

Inference: `safeStorage` cannot by itself satisfy ADR-0002 compatibility because
its documented API encrypts/decrypts strings but does not retrieve generic
passwords by the predecessor's service/account identifiers.
