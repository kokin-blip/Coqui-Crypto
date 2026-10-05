# Account management and remaining terminal routes

## Migration and compatibility — 2026-10-04

Migration 87 adds profile-scoped connector removal/recovery metadata and verified
wallet identity mappings. Connector IDs, credential scopes, immutable account
references, snapshot hashes, evidence, tax lots, and paper history are retained.
Removal is a local retirement, not remote account deletion or API-key revocation.
Pending removals are excluded from current balances and execution eligibility.
Confirmed cleanup can be resumed after restart; only explicit verified connection
can reactivate a removed connector. Older application versions do not understand
this metadata: downgrading is not safe for enforcing removal semantics.

Nicknames are held in `wallet-nicknames.json` in the installation's application
data directory, separately from credentials and profile databases. Its versioned
map uses hashes of provider, identity kind, and verified provider identity. Coinbase
wallets use the verified portfolio UUID; Robinhood wallets use account identity.
Names follow the same verified wallet across profiles and credential rotation on
this installation; credentials, balances, activity and authority remain isolated.
Missing legacy identity requires verification; names and masked suffixes never
establish identity. Names are not exported with profiles or sent to providers,
Advisor, or telemetry. Duplicate names are allowed with provider/identity context.

Profile duplication continues to strip connections, balances, and authority and
also strips the new connection metadata. The installation nickname map is neither
copied nor deleted by profile operations. Removal retains names for later reconnect;
Clear removes only the nickname. Atomic revision-checked writes fail explicitly
on corruption or conflicts rather than silently replacing local metadata.

## Verification baseline

Before these changes: typecheck and lint passed; 245 test files / 1,568 tests
passed. Existing terminal/activity changes were already uncommitted and are kept.
The existing production build warning for the Ionic chunk was previously recorded.

## Design and implementation evidence

Design file: https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs
Route groups: Settings; Portfolio; Paper; Strategies/Research; Events;
Operations/Risk. Overview and Markets retain their current terminal composition.
Completed screen links, source mappings and verification results are recorded below.

## Editable Figma handoff

All additions preserve the three original pages. Screens use editable Auto Layout,
IBM Plex Sans, component instances and semantic variable bindings; financial values
are unavailable and account names are labeled illustrative. Light and high-contrast
modes use the existing application theme values.

| Route | Desktop node | Main source channels |
|---|---|---|
| Settings | [42:2763](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-2763) | connections.list, wallets.list, accounts.settings, accounts.workspace |
| Holdings | [42:2824](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-2824) | portfolio.current, portfolio.view |
| Allocation | [42:2869](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-2869) | portfolio.allocation |
| Tax | [42:2912](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-2912) | portfolio.tax |
| Reconciliation | [42:2947](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-2947) | portfolio.reconciliation |
| Events | [42:2984](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-2984) | market-events.timeline, market-events.ingest-file |
| Paper overview | [42:3021](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-3021) | paper.exploratory.status, paper.campaign.connections, parallel.paper.status |
| Paper orders | [42:3070](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-3070) | paper.execution.proposals, paper.execution.proposal |
| Paper performance | [42:3109](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-3109) | paper.performance, paper.exploratory.performance |
| Strategies | [42:3156](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-3156) | risk.evidence-gate, research.scoreboard |
| Research | [42:3191](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-3191) | research.runs, research.lineage, research.edge-study, research.negative-findings |
| Operations | [42:3228](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-3228) | operations.floor, activity.feed, decision.detail, alerts.view |
| Risk | [42:3265](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=42-3265) | risk.dashboard, decision.timeline |

[Handoff and source mappings](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=43-3406).
Responsive family representatives: 43:2984, 43:3045, 43:3090, 43:3127,
43:3176, 43:3213. Theme examples: 43:3248 (light), 43:3309 (high contrast).
Removal confirmation, blocked and recovery: 43:3344, 43:3352, 43:3360.
Nickname editing: 43:3368. Loading, empty, error, partial and stale states:
43:3376, 43:3382, 43:3388, 43:3394, 43:3400.

Component additions: account row 41:5; nickname field 41:8; evidence state
41:12; removal confirmation 41:15. Structural review of all 30 additions found
editable frame/text/instance composition, no bitmap fills and no wrong fonts.
Multiline source text sizing was corrected after composition screenshot review.

## Lifecycle implementation notes

Removal and Disconnect share the same eligibility and recovery safeguards. Preview
revisions include connector metadata, current snapshot membership, affected balances
and blockers; the command rechecks them before mutation. A shared operation gate
coordinates synchronization, scheduler ticks and profile switching. Pending cleanup
is persisted before touching the keychain and remains excluded after a crash. Retry
requires a fresh confirmed preview. Active dependent campaigns, unresolved submitted,
approved/executing/unknown executions and live execution/schedule leases block cleanup.
Paused campaigns retain history and cannot resume against an ineligible source.

Cleanup removes only the matching scoped credential/legacy alias and matching legacy
manifest fingerprints. Completed Coinbase removals disappear from active Settings;
historical wallet attribution can still say Removed. Explicit verified reconnect
restores eligibility and the same local nickname. Charts read credentials without
performing alias migrations so background reads cannot resurrect a removed secret.

Current holdings, readiness, status and campaign starts use one eligibility-aware
resolver. It rebuilds recorded contributions from remaining eligible sources, retains
source timestamps, and does not append a synthetic valuation observation. Missing
remaining sources yield an incomplete portfolio and unavailable total. No eligible
recorded sources yields unavailable, not a fabricated zero balance.

All thirteen remaining routes now share compact terminal framing, controls and native
evidence tables, with route-specific source-boundary copy. Existing route hashes,
filters, commands, provenance and evidence inspection remain in their owning screens.
Table scrolling uses a labeled focusable region around the native table. Overview
and Markets keep their composition; local names augment existing account attribution.

The nickname handoff also has separate component-based interaction frames:
[Add](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=46-3149),
[Edit and Clear](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=46-3162),
[Cleared](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=46-3177).
These retain the reusable nickname field and button instances.

New Disconnect callers can supply the displayed preview revision and explicit
confirmation; deprecated requests keep their existing shape and use the same
lifecycle checks. Legacy verification holds the gate throughout its network wait.
A previously verified Coinbase portfolio identity must match before any credential
replacement. Verified legacy connections populate the same canonical identity map;
unprovable migrated wallets remain unnamed until verified.


## Final verification and limitations

- `pnpm verify`: passed type checking, lint, 247 test files / 1,588 tests, and
  repository build. The baseline was 245 files / 1,568 tests. Focused coverage
  includes removal confirmation/revisions, active/disconnected/failed-first-sync
  and legacy connectors, blockers, profile/sync serialization, secret failures,
  matching aliases, restart recovery, balance eligibility/incomplete sources and
  unchanged history; nickname persistence, edit/clear, duplicates, corrupt/conflicting
  storage, verified identities, credential rotation, multiple accounts, profile reuse,
  duplication and backup exclusion.
- Production desktop build passed. Typecheck/lint and the production build were
  repeated after the dialog focus fix. The final production Electron smoke suite
  passed, including disposable-profile removal, blocked unknown execution, nickname
  reuse/clear/re-addition, profile isolation, modal focus containment and restoration.
- Electron performance gate passed: useful warm shell 182 ms; interaction p75
  8.8 ms (200 ms budget). The deliberately injected 250 ms control exceeded the
  budget as required. Terminal performance gate passed a 60-second feed: cold chart
  4,438 ms, cached navigation p75 13 ms, zero viewport drift, removed canvases,
  unchanged extension evaluations and long tasks.
- Reviewed all 13 refreshed routes and account dialogs. The 61 retained PNG captures
  in `docs/design/screenshots/account-routes-2026-10-04` cover desktop/responsive
  layouts, light/high contrast, reduced motion, 200% zoom, nickname interactions,
  confirmation, blocked and recovery states. Navigation wrapping, compact metrics,
  account-row sizing and dialog placement were corrected during review. Cancellation
  focus restoration was corrected following an added smoke assertion.
- Figma composition and structure checks covered the 13 desktop screens, six
  responsive family representatives, theme/evidence states and three explicit
  nickname interaction frames. They remain editable Auto Layout compositions with
  semantic variables and reusable instances; the original three pages and terminal
  screens remain in place. Node links and source channels are in the Handoff above.

No pre-existing test failures were found. The existing large Ionic bundle warning
remains; the build succeeds. Earlier implementation-check failures were corrected
and are not represented as pre-existing failures. Unrelated uncommitted terminal and
activity work was preserved.

These checks use disposable profiles and explicit fixtures: they do not establish
live provider connectivity, tax completeness or reconciled balances. Provider
identity must be verified before legacy wallets can be named. Missing recorded
sources remain incomplete/unavailable. Removal only cleans up local credentials;
it does not revoke remote keys. Recovery requires a fresh explicit confirmation,
and older application versions cannot enforce migration 87 removal metadata.
