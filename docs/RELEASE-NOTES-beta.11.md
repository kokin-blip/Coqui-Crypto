# Coqui 0.1.0-beta.11 — experimental macOS Apple Silicon

- Adds `trendvol-hourly-execution-v1`, a profile-scoped shadow study that models hourly execution of the unchanged completed-daily TrendVol target. Operational Alpaca paper orders remain on the existing daily and five four-hour schedule.
- Adds a read-only hourly quote and venue-rule observation store, independent virtual execution book, restart-safe intents and cooldowns, and chronological matched replay with base and doubled friction.
- Fixes Paper Trading activity response validation for Alpaca fee and reconciliation retry entries, including regression coverage against the service response contract.
- Advances the local database schema to version 84.

The hourly candidate has no Alpaca order submission authority. Modeled fills and costs are research assumptions, not observed broker execution. Automated venue tests use mocks. A connected Coinbase data check and owner-controlled Alpaca paper order/dashboard reconciliation remain outstanding. The macOS build is ad-hoc signed; see `docs/INSTALL.md` for first-launch guidance.
