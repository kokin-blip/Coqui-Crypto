# COQ-32 — Grouped Handoffs Crew Journal

Local implementation on `codex/operations-crew-journal`, based on `6d722e5ba48d38638f28ea0b52776cdb0f4698ca`. This is review evidence, not merged or released work. [Exact prompts and the accepted plan](crew-journal-prompts.md) preserve the originating request, scope answers, grouped-handoffs selection and Figma follow-up.

## Result

Operations now renders its six bot cards, Crew Journal, existing Decision and execution feed, and alerts in that order. The new panel groups explicitly related work, expands the latest group, summarizes older groups, and shows chronological first-person messages with independently expandable technical evidence. It includes all six workers without requiring every worker to speak in every group.

The crew filter, display pause/resume, collapse/reopen, compact/expanded viewport, older-history controls and Jump to latest are implemented. Manual browsing, text selection and evidence focus hold the view. Updates produce one polite availability announcement. Jump and Resume explicitly reset the journal scroll position and focus the stable labeled region. Five groups and 50 entries load initially; retained state is capped at 20 groups and 200 entries, with earlier-history disclosure.

The implementation uses the inspected Coqui Figma library: [Panel 3:64](https://www.figma.com/design/oYzyZ6Spywty2LQ6CT3EBs?node-id=3-64), Header 3:66, Button 3:37, Dropdown 3:56 and Badge 3:46. `CoquiComponents.tsx` provides semantic implementations using existing terminal styles and shared tokens. No Code Connect mappings were returned. Existing crew portraits, typography, theme tokens and bot/feed layouts are preserved. [Design comparison](evidence/coq32/design-documentation.md) records the documentation handoff and pre-existing documentation gaps.

## Evidence and boundaries

- Migration 95 adds immutable, hashed `operations_activity_events_v1` records for missing lifecycle and correlation evidence. It has work/profile/worker/time/source-reference indexes, append-only triggers, idempotent identities and integrity validation. No synthetic history is backfilled. Profile duplication excludes runtime observations from the cloned database while preserving source history.
- Shared adapters project scheduler coordination, strategy datasets, decision/execution evidence, research jobs/attempts/events, parallel paper outcomes, Advisor audit and navigation records. Standard, exploratory and parallel paper remain distinct. Unowned research is labeled global; another profile's linked jobs are excluded.
- Actual evaluation, market refresh, execution-gate, paper-pass and Advisor boundaries record progress and outcomes. Research reuses native lifecycle/attempt records and records interrupted recovery. Exact decision/work/order/client-order/audit identities link handoffs; timestamps and matching instruments do not establish links. Advisor request correlation survives concurrent asynchronous requests.
- Gate observations capture returned results without re-running gates. Observation and diagnostic-reporting failures cannot change task results or trigger order retries. A deterministic paper fixture compares results, decision evidence, orders, fills, balances and ledger with observation writes accepted versus refused.
- Running presentation requires a locally confirmed active attempt and an unexpired deadline. Detached or abandoned starts become current-state-unconfirmed. Historical starts use past tense. Partial paper fills remain waiting until a recorded completion establishes the workflow outcome. Later advice cannot overwrite a refusal.
- Read channels `operations.journal` and `operations.journal.group` validate bounded requests and responses through the existing dispatcher/client. Profile identity comes from the active runtime. They return allowlisted scalar facts, not raw provider requests, credentials or error payloads. Decision-linked evidence reuses the original inspector; other entries retain their own identities and facts.
- SQL pages group identities before loading entries, applies stable keysets before limits, preserves source sequence where available, and deduplicates native records referenced by lifecycle observations. The bounded projection cache uses SQLite `total_changes` and `data_version` to notice local and detached writers. Active work expires from cached running state too.
- Two-second refresh policies live in the central query table. A shared foreground subscription stops the journal when another app owns focus, in addition to browser visibility handling. Collapse/navigation disable polling. Reopening/refocusing refreshes it. Profile-scoped query keys, abort handling and a keyed journal reset discard prior-profile state and late results. Group revisions invalidate open decision evidence. No component timers, sockets or model calls were added.

Source-derived study manifests were regenerated for the instrumented source identities. Strategy mathematics, order identities, gate ordering and existing execution authority remain covered by the unchanged financial fixtures and regression suite.

## Automated verification

See the machine-readable [native checks](evidence/coq32/electron-checks.json) and [read benchmark](evidence/coq32/read-performance.json). All data and screenshots in that directory use isolated synthetic fixtures, not an owner's trading history. Native scripts disable the scheduler and mock network access; the journal itself invokes no evaluation, research or Advisor command.

The focused checks cover storage integrity/idempotency, profile/global scope, equal-timestamp pagination, six-worker grouping, concurrent Advisor correlation, detached writers, interrupted/expired work, partial/delayed fills, observation failures, Figma component presence and accessible presentation states. Migration tests preserve exact prior rows across every preceding schema. Existing financial and execution suites remain applicable.

The native check exercises placement, one-group expansion, readable messages, technical disclosure/focus retention, explicit Jump behavior, filtering, pause/resume, foreground/collapse/navigation polling, 200-entry bounds, finite sustained-update heap growth, profile switching with a delayed prior-profile response, themes, zoom and absence of evaluations/fills from viewing. It also records IPC-to-painted-frame timing.

The first full run exposed old assertions expecting schema 94 in backup/profile/storage fixtures; those assertions now expect migration 95. The first high-volume benchmark exposed a correlated source-reference scan at roughly 2.65 seconds p95. A materialized, profile-bounded source-reference membership query removed that scan; final timings are recorded in the JSON evidence. Initial theme captures were rejected because the harness had not actually reloaded preferences; the committed captures assert their real theme before capture.

Final command results and measured values are recorded in [verification](evidence/coq32/verification.md).

## Review status and remaining gates

The independent UI finish review found one P2 navigation/focus issue. Its verdict pass scored the correction **resolved**, with disposition **ship at verdict-pass scope**. This is a finding-specific UI verdict, not release approval. The documenter confirmed an ordinary extension of the incumbent design system and left its existing files unchanged.

Human VoiceOver verification, owner/code review, real-profile review and release approval remain open. The heap check is a bounded fixture exercise, not a multi-hour production soak. No claim is made about live provider operation or qualification of trading results. Keep COQ-32 **In Review**, not Done, after automated checks are complete.
