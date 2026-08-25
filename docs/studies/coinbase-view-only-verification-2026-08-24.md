# Coinbase View-only Verification

Status: **ready for owner-run verification; no real key has been exercised yet**.

The local harness uses the production connection service, permission probe, accounts-read canary, OS keychain, and an ephemeral profile manifest. It rejects key files inside this repository. Credentials are read from the file named by `COQUI_COINBASE_KEY_FILE`; they are never accepted as command-line arguments.

Run with Node 24 after selecting a Coinbase key file outside the repository:

```sh
COQUI_COINBASE_KEY_FILE=/absolute/path/outside/repository.json pnpm coinbase:verify-view-only
```

The harness emits one JSON record containing only the code revision, timestamp, HTTP status classes, permission booleans, a stable outcome code, and cleanup result. It does not emit the key name, file path, portfolio UUID, fingerprints, or secret material.

A passing run requires View permission and rejects Trade, Transfer, and Receive authority. It then disconnects and proves that the ephemeral keychain entries and manifest fingerprints were removed. P7 remains open until the owner completes a passing real-key run and preserves the sanitized result as evidence.
