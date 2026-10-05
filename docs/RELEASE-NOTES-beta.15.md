# Coqui Crypto 0.1.0-beta.15 — experimental

This release combines the terminal and research improvements prepared for beta.14 with the latest account-management, chart, and allocation refinements.

- Unified trading terminal with market depth, recent trades, paper positions and proposals, decision history, and research views.
- More responsive market charts, cached history navigation, candle-aligned activity markers, and paper entry/P&L annotations.
- Verified wallet nicknames shared locally across profiles, with clearer account attribution and connector removal/recovery.
- Refined Portfolio, Paper, Research, Risk, and Settings routes to match the terminal interface.
- Compact allocation donuts that fit holding-detail panels, legends with USD values and stable asset colors, and an accounting composition bar linked to table selection. Partial connected allocations explicitly show shares of priced holdings.
- Updates the pinned `brace-expansion` dependency to 5.0.12 to resolve the production dependency audit findings.
- Improved parallel paper execution, reconciliation, recovery, and order reporting.
- Verified multi-venue archive acquisition and stronger research-integrity tooling. The opt-in TrendVol research candidate remains disabled by default.

Connected holdings, imported accounting evidence, and paper simulations remain separate. Live exchange trading remains disabled. Historical research features do not establish strategy profitability.

## Compatibility and installation

Database migration 87 adds connector removal/recovery metadata. Older versions do not understand the removal semantics; downgrading after migration is not supported. Wallet nicknames stay on this installation and are excluded from profile exports.

The release includes macOS Apple Silicon DMG/ZIP and Windows x64 installer/ZIP artifacts with SHA-256 checksums. macOS builds are ad-hoc signed and Windows builds are unsigned; see [installation guidance](https://github.com/kokin-blip/Coqui-Crypto/blob/p5-shell-and-ui/docs/INSTALL.md).
