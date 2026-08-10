# ADR-0002 — Preserve the predecessor keychain identity

**Status:** ACCEPTED
**Date:** 2026-08-01

## Decision

Keep the keychain service string `kokincrypto` and the predecessor's
wallet-scoped account identifiers when migrating secrets.

Use the pinned `@napi-rs/keyring` 1.3.0 asynchronous keytar-compatible facade
for the production adapter. Fail closed with stable, secret-safe errors if the
native credential manager or module is unavailable.

## Reason

The application is being replaced without invalidating existing local data.
Changing the service identity would strand view-only Coinbase credentials and
force unnecessary re-entry. Product branding is not a reason to break the local
secret-store identity.

The archived `keytar` dependency is not preserved. Phase 2 evaluated Electron
`safeStorage`, but its API encrypts application-managed blobs and cannot address
the predecessor's generic-password entries by their existing service/account
identity. Using it alone would therefore strand the credentials this ADR exists
to preserve. `@napi-rs/keyring` provides asynchronous native credential-manager
access and a keytar-compatible interface without restoring the archived package.

## Consequences

- Existing installs can retain wallet-scoped credentials.
- The service string is compatibility infrastructure and must not be casually
  renamed.
- Native keyring loading is lazy; absence never falls back to plaintext or an
  application database.
- The native module must be exercised in Node and packaged-Electron CI on every
  supported target.
- Secrets remain main-process-only and never enter logs, IPC, databases, exports,
  or the Python research toolchain.
