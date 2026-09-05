# Typography and UI polish review — 2026-09-04

Status: implementation verified; owner visual approval pending. This does not
replace or change the earlier approved review or its screenshots.

## Changes for review

- Locally bundled IBM Plex Sans Variable 5.3.0 replaces Manrope. System monospace
  remains for hashes and canonical data; all explicit font weights are at most 700.
- Shared control states and surface-state presentation preserve the approved
  workstation layout, navigation, green palette, density, and paper-only identity.
- Markets, analyst, extension, drawing, and popover surfaces use semantic theme
  tokens. Chart-series and drawing colors retain their distinct data meaning.
- Settings now exposes existing view-only Coinbase connection and immutable
  evidence sync. Credential-file contents are read only during submission and
  are not rendered or put in query cache. Disconnect requires confirmation.

## Additive captures

The 38-image set is in [review-2026-09-04-polish](screenshots/review-2026-09-04-polish/).
Representative captures:

- [Advanced overview](screenshots/review-2026-09-04-polish/research-grid-dark.png)
- [Simple light overview](screenshots/review-2026-09-04-polish/simple-overview-light.png)
- [Markets light](screenshots/review-2026-09-04-polish/markets-light.png)
- [Coinbase disconnected](screenshots/review-2026-09-04-polish/coinbase-settings-disconnected.png)
- [Coinbase connected](screenshots/review-2026-09-04-polish/coinbase-settings-connected.png)
- [Coinbase evidence result](screenshots/review-2026-09-04-polish/coinbase-sync-result.png)
- [Coinbase attention required](screenshots/review-2026-09-04-polish/coinbase-settings-attention.png)
- [Settings intermediate width](screenshots/review-2026-09-04-polish/coinbase-settings-intermediate.png)
- [Settings 200% zoom](screenshots/review-2026-09-04-polish/coinbase-settings-200-percent.png)

Captures use a throwaway migrated profile and production renderer/dispatcher.
Coinbase states use an offline verifier, a generated disposable key, an in-memory
credential store, and empty account/fill/transaction fixtures. The successful
sync screenshot and later rail reconciliation state are test evidence, not an
owner account result. No real Coinbase credential is used or captured. Appearance
is persisted through the settings contract, then checked before capture to avoid
races with the preference boundary. Previously approved directories are untouched.

## Verification and limits

- `pnpm verify`: 171 files, 1,133 tests passed, plus typecheck, lint, build.
- Electron smoke: passed, including excessive-permission rejection, replacement
  key file, command deduplication, sync failure/success, profile isolation,
  disconnect confirmation/cancel focus, and secret-free rendered/readback data.
- Screenshot clipping checks: passed across dark/light, high contrast, compact,
  reduced/no motion, intermediate width, and 200% zoom captures.
- Performance gate: passed; see [measurement](../studies/renderer-polish-performance-2026-09-04.md).
- Production dependency audit: no known vulnerabilities reported.
- Impeccable detector ran once in degraded regex mode because bundled HTML parser
  modules were unavailable. It did not evaluate computed contrast or selector
  matching; its exit status is not a full accessibility certification.
- Native screen-reader and Windows forced-colors review remain manual release
  checks. Owner approval of typography and this additive screenshot set is pending.

## Owner decision

Pending. Review font fit, financial-table legibility, control consistency, and
Coinbase recovery copy. No navigation or financial-state semantic redesign is
proposed, and no live Coinbase smoke test is claimed by this UI review.
