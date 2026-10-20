# COQ-32 prompt evidence

## Originating prompt

can we plan for a feature in operations that have a little terminal window that allows the user to see the algorithm thinking?

## Scope answers

Readable decisions + technical details

All Operations crew activity

## Placement and voice follow-up

We could add this console in this area below the 6 bots and above the decision feed. lets make it so this console has actual readable decisions, e.g "im looking at BTC-USD: Scout" etc. etc. the same for the other workers. It doesnt have to be like an actual console it can be a stylized text area or something. brainstorm

## Selected design

I like the grouped handoffs. Let's implement it below the 6 bots and above the decision feed, with readable updates from all workers and expandable technical details. Create a comprehensive plan to make this.

## Implementation prompt (verbatim)

PLEASE IMPLEMENT THIS PLAN:
# Grouped Handoffs Crew Journal — COQ-32

## 1. Summary and confirmed direction

Add a **Crew Journal** directly **below the six Operations bots and above the existing Decision and execution feed**.

Use the selected **Grouped handoffs** design: related worker updates appear together under an evaluation or job heading. Messages use readable first-person language, with expandable technical evidence.

Confirmed choices:

- Include all six workers.
- Show genuine progress and completed results.
- Expand the latest group by default; summarize older groups.
- Preserve the bots and detailed decision feed.
- Use the app’s existing visual style and robot assets.

The journal observes existing work. Opening it must not start evaluations, research jobs, Advisor requests or execution.

**Verified baseline:** clean checkout at `6d722e5ba48d38638f28ea0b52776cdb0f4698ca`. Existing activity-feed and channel-contract tests pass: **27 tests across two files**.

## 2. User experience and message behavior

### Placement and appearance

The Operations page becomes:

1. Six existing bot cards.
2. New **Crew Journal**.
3. Existing Decision and execution feed.
4. Existing alerts.

Use a compact panel with the current typography, neutral surfaces and subtle dividers. Sentences use normal UI type; timestamps and identifiers may use monospace. Reuse small crew portraits beside names.

The header contains the title, last successful refresh time, crew filter, **Pause updates**, and collapse control. Default to **All crew**.

### Grouped handoffs

Each group header shows:

- Evaluation/job label and affected instruments when known.
- Paper source or campaign context.
- Start time and latest update time.
- Recorded state: running, completed, waiting, blocked, failed or unknown.

Example structure:

> **BTC-USD · paper evaluation**  
> **Coqui:** I started this scheduled evaluation.  
> **Scout:** I checked the latest completed BTC-USD candle.  
> **Guard:** I blocked this paper plan because the risk check refused it.  
> **Courier:** I recorded the refusal. No order was submitted.  
> ▸ Technical details

These are presentation examples; actual reasons and outcomes come from records.

A multi-asset evaluation gets one group listing its instruments. Do not invent separate BTC and ETH evaluations when the algorithm evaluated a portfolio.

Independent research jobs, market refreshes and Advisor requests get separate groups unless explicit source identities link them to an evaluation. Do not force all six workers to speak in every group.

### Worker voice

| Worker | Updates to cover | Example wording |
|---|---|---|
| **Coqui** | Actual work starting, finishing, cancellation and coordination failures | “I started the next scheduled evaluation.” |
| **Scout** | Instrument/data checks, refresh progress, completed-bar evidence and recorded signal facts | “I’m checking BTC-USD using completed candles.” |
| **Guard** | Actual eligibility and execution-gate results, skipped checks and refusals | “I blocked this plan because the market data is stale.” |
| **Darwin** | Research queued, started, completed, failed, cancelled and retried | “I finished the research job. Its result is ready to inspect.” |
| **Courier** | Planning, review requirements, submission attempts, acknowledgement, fills and recovery | “I submitted the paper order. Its fill is not confirmed yet.” |
| **Advisor** | Explanation requests, completion, fallback, failure and navigation outcomes | “I explained this decision using its recorded evidence.” |

Use deterministic templates, not generated narration. Include recorded signal values or thresholds when they explain the outcome and are available.

Present tense requires a currently confirmed running operation. Completed entries use past tense. A short synchronous operation may start and finish between refreshes; show its real history without delaying it to manufacture visible progress.

### Expansion, history and updates

- Initially load **five group summaries**, with the newest group expanded.
- Allow **one expanded group at a time**.
- Sort groups by latest activity, newest first. Within a group, show events chronologically, preserving recorded sequence where available.
- Load the latest **50 entries** for the expanded group; offer older entries through pagination.
- Bound the client cache to **20 group summaries and 200 entries for the expanded group**. Display when older content is available rather than silently implying complete history.
- Use a desktop journal viewport capped at approximately **420px**, with an expand control. Reflow text and controls at narrow widths and 200% zoom.

Manual expansion or scrolling back holds the user’s current view. New activity must not steal focus, change the open group or jump the scroll position. Show **New activity available** and a **Jump to latest** action.

**Pause updates** freezes the displayed journal while collection and algorithm work continue. Resume refreshes the latest state. Collapsing the entire journal disables its polling until reopened.

### Technical details

Each entry can expand to show applicable, allowlisted evidence:

- Source timestamp and record identity.
- Profile/global scope and instrument identity.
- Run, decision, campaign, job, proposal and order links.
- Recorded reason codes and gate outcomes.
- Strategy/version, completed market interval and freshness.
- Recorded signal facts, amounts and hashes when available.

Non-decision events retain their own evidence inspection. Decision-linked entries reuse the existing decision-detail presentation.

Distinguish loading, confirmed empty, filtered empty, paused, stale, partial history, failed reads and unavailable evidence. With no new activity, show **Waiting for the next recorded update**.

## 3. Evidence, lifecycle recording and grouping

### Reuse existing records

Build shared source adapters over the existing scheduler, decision, execution, research and Advisor records. Include standard paper, exploratory paper and parallel paper activity; label their sources distinctly.

The current implementation needs three targeted additions:

- **Progress coverage:** latest-state cards and completed records do not provide a complete task lifecycle.
- **Guard evidence:** the decision contract supports risk events, but the paper execution path needs to record the actual gate outcomes it already computes.
- **Correlation and pagination:** events need explicit work identities, and source cursors must be applied before source limits. The existing activity-feed merge cannot be reused unchanged for deep journal history.

### Add missing lifecycle evidence

Add the next forward-only migration—currently **95**—for an append-only `operations_activity_events_v1` table.

Store only missing lifecycle and correlation evidence:

- Stable event and work identities.
- Attempt identity and worker.
- Profile/global scope and execution source.
- Phase, status and source timestamp.
- Relevant existing run/job/decision/proposal/order references.
- Operation owner/session and deadline where applicable.
- Typed, allowlisted facts and references to authoritative source records.

Index work histories and profile/global chronological reads. Follow existing immutable-record and integrity conventions. No backfill of invented starts, progress or completion times.

Instrument actual operation boundaries:

- **Coqui:** evaluation/task execution boundaries, rather than treating lease acquisition as proof of work.
- **Scout:** market refresh and completed-dataset validation boundaries, with instrument identities.
- **Guard:** eligibility and gate execution boundaries; capture returned outcomes without rerunning checks.
- **Darwin:** reuse research lifecycle events and worker-attempt records.
- **Courier:** reuse existing planning/order/fill/recovery evidence; add missing lifecycle/correlation records.
- **Advisor:** capture request start and outcome with subject identity; reuse existing audit evidence.

Record only meaningful transitions. Suppress routine lease renewals, unchanged polling checks and repeated identical source events.

Instrumentation must preserve calculations, gate ordering, scheduling, deadlines and execution behavior. Observation failures must use existing diagnostic reporting and must not change a trade outcome or cause an order retry.

### Correlation rules

- Use the existing source/run identity as the evaluation group identity; distinguish retries by attempt.
- Establish the identity before new lifecycle records are written. Attach later decision and proposal identities through explicit references.
- Group research by job identity and Advisor work by request/subject identity.
- Keep market refreshes standalone unless a caller explicitly supplies their parent work identity.
- Correlate delayed fills and recovery through stored order/proposal links.
- Never join work solely because timestamps, instruments or display names match.

Research linked to the active profile uses that scope. Unowned global jobs remain clearly labeled **Global research**; jobs belonging only to another profile are excluded.

After a crash, restart, expired deadline or lost ownership, an unfinished start must become **Current state unconfirmed** unless authoritative evidence confirms it is still running. Do not invent successful completion or failure.

Use the same source adapters for relevant bot-card state updates so the cards and journal do not contradict one another. Preserve the cards’ layout.

## 4. Interfaces and implementation sequence

### Typed read interfaces

Add two read-only channels through the existing contracts, dispatch and `CoquiClient` infrastructure:

| Channel | Purpose |
|---|---|
| `operations.journal` | Paginated group summaries, crew filter, revision, refresh timestamp and per-worker coverage |
| `operations.journal.group` | One group’s paginated entries, readable messages, technical evidence and coverage state |

The active profile comes from the existing application boundary, not an arbitrary renderer-supplied profile.

Responses carry explicit pagination and partial-history information. Group detail returns bounded technical facts; it does not forward raw stored JSON, provider prompts, credentials or error objects.

Keep existing feed and decision channel contracts compatible.

### Refresh and query behavior

- Register **two-second polling** for journal summaries and the expanded group in the centralized query policy.
- Poll only while the journal is mounted, expanded and the app is foregrounded.
- Use SQLite revision/change detection to cache unchanged projections, including changes from detached writers.
- Refresh on reopening, refocusing and relevant confirmed commands.
- Include group revision in decision-detail invalidation so new evidence does not leave an open inspector permanently cached.
- Clear journal state and reject late results on profile switches.
- Add no component timers, new sockets or general event-stream protocol.

Pagination uses stable keysets applied **before** per-source limits. Page group identities before loading their entries, and deduplicate by source identity when lifecycle records reference existing outcomes.

### Delivery order

1. Implement lifecycle storage, typed source adapters, grouping, pagination and deterministic message templates.
2. Instrument missing operation boundaries and correlate real source outcomes.
3. Add the two channels, query policies, caching and detail invalidation.
4. Build the grouped journal and integrate it between the bots and feed.
5. Verify behavior, accessibility, performance and compatibility; prepare the reviewable implementation.

Default scope includes the six workers and existing paper sources. Export, configurable personalities, free-form chat and additional filters beyond crew selection are deferred.

## 5. Verification and acceptance

### Storage, lifecycle and source correctness

Test:

- All six workers’ supported transitions and message templates.
- Progress → completion, refusal, cancellation, failure and unknown outcomes.
- Existing completed records without newly invented progress.
- Standard, exploratory and parallel paper source separation.
- Research retries, global jobs and profile isolation.
- Explicitly linked handoffs versus unrelated simultaneous jobs.
- Partial fills, delayed fills, uncertain submissions and recovery.
- Idempotent writes, integrity failures and observation-write failures.
- Restart, lost ownership, expired operations and detached writers.
- Same-timestamp ordering, late-arriving events and pagination across multiple busy sources.
- Migration from the current schema with prior evidence preserved.

Run the same deterministic paper fixtures before and after instrumentation. Financial results, order identities, gate outcomes and execution ordering must remain unchanged.

### UI and interaction

Verify:

- Exact placement and preservation of the six bots and decision feed.
- Latest-group expansion, older-group summaries and crew filtering.
- Entry details for decision and non-decision evidence.
- Pause/resume, collapse/reopen, historical browsing and jump-to-latest.
- Stable focus, selection, open details and scroll position during updates.
- Empty, loading, filtered, stale, partial and failed states.
- No permanent “running” presentation after an interrupted operation.

Use component tests for presentation and Electron interaction tests for focus, scrolling, polling and profile-switch behavior.

### Accessibility and performance

Check keyboard operation, explicit expansion state, non-color status labels, light/dark/high-contrast themes, reduced motion, 1280-width layout and 200% zoom. Batch screen-reader update announcements; do not announce every incoming line. Record human VoiceOver verification separately.

Measure a representative high-volume fixture:

- Journal read-handler p95 below **100ms** on the test machine.
- Existing interaction budget of **200ms p75** preserved.
- Bounded rendered content and retained memory during sustained updates.
- No journal polling after collapse or navigation away.
- No additional provider requests caused by viewing the journal.

### Completion and tracking

Run focused regression tests, `pnpm verify`, the desktop build and relevant Electron smoke/performance checks. Report actual results and remaining review gates.

Reuse **COQ-32**. During implementation, record this plan, the exact originating and scope-changing prompts, evidence links and verification results. Move it to **In Review** when implementation and automated checks are complete; retain unmet human-review or release gates. Completion comments end with **Completed by: kokin**.

This turn is planning only. Application files and Linear remain unchanged; synchronizing the selected design and final plan to COQ-32 is pending execution mode.

## UI follow-up (verbatim)

MAKE SURE YOU USE THE FIGMA UI COMPONENTS AND SUCHa

## Execution interpretation

The leading implementation request and current execution mode authorize application changes. The final planning-only paragraph is retained above as part of the supplied plan, not treated as a cancellation of the request to implement it. No credentials were included in these prompts.
