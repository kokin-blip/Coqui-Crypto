# Coqui Crypto 0.1.0-beta.16 — experimental release candidate

This candidate adds research-only News Intelligence. Publication requires passing CI, macOS and Windows packaged smoke tests, checksummed downloadable artifacts and the outstanding human review of the stacked news changes. It is not a published release yet.

- GDELT headlines and metadata retain immutable observation and analysis provenance. News does not influence strategy targets, execution or live orders.
- Events includes news evidence; Settings includes provider request health and opt-in Main-only analysis; Research shows study status. Existing RSS, local event fixtures and research registrations remain intact.
- Restartable immutable analysis chunks, worker isolation and fenced scheduling support explicit or opt-in analysis. New installations remain disabled. Reviewed mappings must bind existing Coinbase BTC/ETH/SOL identities before scheduled analysis can be enabled.
- Verified GDELT Parquet archives and daily/hourly study tooling use actual availability times. Daily 24-hour and hourly 1-, 4- and 24-hour studies require prospective history. No predictive performance is established by synthetic tests or reconstructed history.
- Windows test harness module imports use file URLs. Native fullscreen smoke checks wait for completed platform transitions.

## Data and recovery

The operational schema advances through migrations 88–91 using normal pre-migration backups. Migration 91 adds immutable analysis chunk headers and cached observation analyses. Earlier evidence is preserved. Downgrading a migrated database is unsupported; restore a verified pre-migration backup with the matching older application instead.

Archive exports are content-addressed, atomically published and verified before use. Interrupted hidden temporary directories are not published datasets. Keep SQLite as the operational authority; archives cannot substitute for a verified database backup. See `docs/studies/news-intelligence-rollout-2026-10-09.md` for commands, bounds and recovery.

GDELT Project — https://www.gdeltproject.org/. Publisher-host diversity does not establish independent corroboration. First-page coverage remains unknown.

Marketaux and Currents scheduled collection, article retention and exports remain disabled pending credentials and retention permissions. Current Main validation has no retained GDELT article and no required canonical registry identities; analysis stays disabled. Live validation and prospective evidence gates remain open.

macOS artifacts use existing ad-hoc signing; Windows artifacts follow the existing experimental packaging workflow. Live trading remains disabled. Cost remains $0.
