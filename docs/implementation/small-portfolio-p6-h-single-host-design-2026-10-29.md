# P6-H: selected single-host direction

October 29, 2026. The owner delegated the intended-host/topology choice. The selected direction is **this Mac as the sole intended paper-trading host**, one shared account authority outside individual profiles, and one reviewed broker dispatch owner at a time. Other Coqui hosts and non-owner profiles are observers for this account once enrollment is explicitly reviewed and enforced. Do not introduce a cross-host network coordinator/gateway in this slice.

This resolves the design choice recorded in the [H readiness plan](small-portfolio-p6-h-readiness-plan-2026-10-29.md). It does not establish current device identity, account UUID mapping/dedication, exclusive credentials, financial completeness, reviewed source or operational enrollment. The [disabled journal foundation](small-portfolio-p6-h-authority-delivery-2026-10-29.md) still grants no execution or funded-claim authority. The full [roadmap](small-portfolio-profit-policy-plan-2026-10-23.md), P6/P7 requirements and [tracker](small-portfolio-phase-tracker-2026-10-23.md) remain intact.

## Verified identity gap and intended implementation

Source inspection finds desktop composition defaults to a new `desktop-${randomUUID()}` owner each runtime, while headless defaults to `headless-local` (`apps/desktop/src/main/composition.ts`, `apps/headless/src/index.ts`). These are runtime/profile authority identifiers, not proof of one physical machine. Do not use them as a persistent device enrollment or infer host exclusivity from their names.

Before operational enrollment, implement and review:

1. A stable, explicitly enrolled device identity, separate from financial account ID, journal registry, profile and per-process owner. Merely copying an identity/journal cannot prove that a second machine is excluded. The OS credential boundary and actual writer roster must be verified.
2. One explicit per-user authority home outside profile directories, shared by desktop/headless consumers on this Mac. It must have a verified registry identity and restrictive access. Profile creation, connection rename, restore or import cannot create a competing authority home. No default path or file is installed by the current foundation.
3. A unique admitted dispatch owner/process per account, enforced at every order/cancel entry and applicable claim/settlement boundary. Existing host/profile fencing remains necessary. Desktop/headless cannot each treat themselves as separate cash owners. A lost/expired owner does not authorize a replacement until admitted/in-flight/unknown operations and prior claims are reconciled.
4. A read-only observer path for other hosts/profiles. Broker write credentials and uncovered writers must be excluded by the reviewed topology; an application UI flag or claimed device ID is insufficient. Unknown or retained uncontrolled credentials block enrollment. No claim is made that a broker understands Coqui fencing tokens.
5. Actual P1/P2/P6 common-cut, claim/backing/H, fee/hold/manual-activity evidence and a separately versioned operational authority contract. Preserve the existing V1 budget refusals; a connected account cannot be relabeled `isolated_book`, and the evidence-only journal cannot be cast into a funded permit.

The existing account and comparison campaigns remain subject to their saved gates. Enrollment requires exact COQ-12 source review, reconciliation of existing writers/credentials and separately permitted intended-host COQ-14 observations. This choice performs no credential revocation, campaign stop/reset, host assignment, broker call, migration, journal installation, Resume or new trading action. All actual account/host/source/rights/native/cost evidence remains pending; no external payment/live authority exists.

## Prompt used

Commit and push the P6-H readiness work, then continue building the account-wide authority using the saved plan. Preserve unrelated work and the full P0–P7 scope, keep unmet evidence gates pending, and update the phase tracker.

Relevant follow-up question:

> For the later connected-authority integration, which machine should be the intended paper-trading host, and should all other hosts be prevented from submitting orders to the paper account ending YT3T? This does not block the disabled journal and tests I’m building now.

Exact owner answer:

> Whatever you think is the most sensical
