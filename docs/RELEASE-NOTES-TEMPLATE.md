# Coqui 0.1.0-beta.9 — experimental

- Added Alpaca Paper connection and parallel TrendVol paper comparison.
- Added headless algorithm tooling for inspecting decisions.
- Verified desktop startup and packaged database migrations on macOS Apple Silicon.

Alpaca orders are **paper orders on Alpaca's service**, not live exchange trades. An end-to-end test with a connected Alpaca account is still pending. Coinbase remains read-only. The macOS build is ad-hoc signed; see `docs/INSTALL.md` for first-launch guidance.
