# Coqui 0.1.0-beta.3 — experimental macOS build

Local-first connected portfolio tracking, separate tax-lot accounting,
allocation, and paper-trading research. No account, no server, no cloud database.

**This build cannot place a real order.** Not by configuration — the code path
does not exist, and a Coinbase key carrying trade or transfer permission is
rejected at connect time. The Robinhood Crypto adapter is read-only and exports
no real placement method. Paper figures are a simulation and are labelled as one
wherever they appear.

## Fixed in beta.3

- **Guided setup now appears in front of the application.** The modal layering
  tokens the shell referenced were never defined, so the onboarding dialog (and
  every other modal) could render beneath the sidebar and status rail.
- **Coinbase sync produces a portfolio again.** Coinbase stopped returning the
  legacy `usd_from`/`usd_to` fields on its fee-tier summary, and that failure
  discarded an otherwise complete accounts-and-fills dataset, leaving the
  connected portfolio empty. The parser now falls back to the documented
  `aop_from`/`aop_to` range, and fee-tier evidence — provenance, not pricing —
  degrades to null instead of failing the whole sync.
- **Connecting reports the truth.** A failed first synchronization no longer
  shows "Credentials verified". The connection is kept for resume and the
  actual failure is shown.

## Downloads

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `Coqui-<version>-mac-arm64.dmg` |
| Windows (x64) | `Coqui-<version>-win-x64-setup.exe` |

There is no Intel Mac build: nothing verifies one, and shipping a binary no gate
covers would be a claim this project cannot back.

## Verify your download first

`SHA256SUMS.txt` is attached. The checksums are generated on the build runner
and re-verified against the *published* assets after upload, so a file corrupted
in transit is caught before you ever run it.

```
shasum -a 256 -c SHA256SUMS.txt          # macOS / Linux
certutil -hashfile <file> SHA256          # Windows
```

## First launch

Coqui is **ad-hoc signed**, not signed with an Apple Developer certificate, so
both platforms will warn about an unverified publisher on first open.
`docs/INSTALL.md` explains what to expect, and — importantly — how to tell the
expected warning apart from the one that means the download is broken.

## Verified by this build

- Full `pnpm verify` on the tagged commit, before anything was packaged.
- The packaged application opened a migrated database through `node:sqlite`
  from inside the asar archive, on each platform it ships for (ADR-0003's gate).
- macOS: ad-hoc signature present, arbitrary network loads denied, camera,
  microphone and Bluetooth usage descriptions stripped from the bundle.

## Known limitations

- Live trading does not exist and is not planned for this build.
- Validated paper mode still stands down without applicable verified edge
  evidence. The explicitly confirmed Exploratory Paper mode may observe the
  current unvalidated TrendVol strategy without inventing an edge: failed or
  unavailable profitability remains visible, all safety gates remain active,
  and its evidence is ineligible for validation, promotion, or live execution.
- Real Coinbase, Robinhood Crypto, and CoinGecko access needs your own keys.
  Coqui ships none; connection secrets remain in the OS credential store.
