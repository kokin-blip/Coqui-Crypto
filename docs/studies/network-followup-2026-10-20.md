# Installed beta.18 network follow-up

## Prompt used

> Open the app with all the new updates and determine if the network failures are still present.

## Result

No current Alpaca network failure was reproduced. `/Applications/Coqui.app` was opened with native app control and its Paper Overview was inspected. The installed version is **0.1.0-beta.18**, source hash `69e8a4a67c5001c2d48a81cb807c1d3706176ec780d6b15501b2b69d437d7f0e`, matching the verified fee update.

At 2026-10-20T19:14:18Z (12:14 PM Phoenix), journal review found **240 received broker reads and zero unavailable reads** since the first matching beta.18 runtime at 18:30:28Z: 40 account, 40 orders, 80 activities, and 80 positions. No transport reconciliation failures were recorded in that interval. The app was not continuously running for the whole wall-clock interval; there was a shutdown/reopen gap. These counts cover observed requests, not an uninterrupted uptime claim.

A new **Retry reconciliation** in the actual installed app completed its broker reads and retained **Waiting for fee evidence**. The execution stream changed from its initial unavailable display to **Listening**. Coinbase market-feed and market-context reads also became live in the UI. Submission attempts remained 14 and the experiment remained paused; no Resume, submit, cancel, or other financial command was used.

A separate read-only probe executed the installed adapter under the matching Electron runtime. It returned HTTP **200 on the first attempt** for account, orders, positions, activities, and Alpaca US crypto quotes. Approximate elapsed times were 394, 119, 232, 77, and 220 ms respectively. The returned BTC/ETH/LTC quotes passed the installed freshness validator. No credentials, account identifiers, balances, holdings, or quote prices were emitted by the probe. It performed no order mutation or profile database write.

The stale quote timestamps visible in the recovery panel were old retained execution evidence. While waiting for fees, exact reconciliation does not need market quotes and exits before the post-recovery quote-health read. The separate fresh quote request succeeded; old cached quote timestamps alone do not establish a current endpoint failure.

The current block remains the exact position/fee reconciliation mismatch documented in the beta.18 report. Published fees still have not explained the missing quantities. Successful network requests do not resolve that accounting gate or enable trading.

## Evidence and limits

- [Initial recent-journal summary](../implementation/evidence/oct20/network-followup-initial.json).
- [Final installed-runtime journal summary](../implementation/evidence/oct20/network-followup-final.json).
- [Read-only installed-adapter probe](../implementation/evidence/oct20/network-followup-probe.mjs) and [results](../implementation/evidence/oct20/network-followup-probe.json).
- [REA process capture](../implementation/evidence/oct20/network-followup-rea-evidence.json): `ev_d3739be90eb320d33932504032d991c0c8978f6ecc7419bfba6a00c097d8ba54`.

The probe is a separate connection from the running app. REA captures process output, not network packets. The journal and current successful requests establish observed health over a bounded period; they do not rule out future intermittent DNS, socket, TLS, or provider failures. The old build discarded the underlying transport codes, so the historical failures' exact causes remain unknown.

The first app-control permission review timed out and succeeded on one retry. An initial read-only SQLite connection could not open before normal app startup; it succeeded after opening the app. Neither was an Alpaca transport result. No production source change or rebuild was needed for this check. The probe script passed lint. Private diagnostic details remain local; Linear receives a progress-only update and no operational/release acceptance gate is closed.
