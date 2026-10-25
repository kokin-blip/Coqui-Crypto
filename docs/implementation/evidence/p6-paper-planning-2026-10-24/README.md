# P6 planning evidence

[Concrete plan](../../small-portfolio-p6-implementation-plan-2026-10-24.md), unchanged [roadmap](../../small-portfolio-profit-policy-plan-2026-10-23.md), [tracker](../../small-portfolio-phase-tracker-2026-10-23.md).

Planning only. P5-A–G is pushed as `775950a0f3c539755a626a1fe058b55ef8f5787f`; P5-H remains pending. No P6 application code, installed-account inspection, broker/network call, book creation, setting activation, order/withdrawal, registration or release.

- `baseline.json` records the pushed base/remote tracking identity, 495 pre-existing dirty entries, 81 protected hashes, index and exact prompt. `tracker.before.md.txt` preserves the pre-planning tracker.
- `source-inventory.json` records 55 source/interface/dependency paths and both HEAD/working hashes. Five have existing uncommitted changes; the plan identifies conditional reuse/review and does not treat them as released source. Critical findings are distinguished from future design choices in the plan.
- `probes.mjs`, `probes.json`, `probes.log` contain six independent synthetic assertions on an in-memory database against the exact verified P5 source closure: cash-funded empty opening is refused without facts; generic P2 funded-claim writer refuses without claims; pure P2 deducts a reserve once; unsafe direct P3 modeled reuse double deducts it. The correct P6 $680/$650 values are hand arithmetic requirements, not P6 implementation results.
- Probe reproduction: build an appropriate source closure, then run Node 24 `node docs/implementation/evidence/p6-paper-planning-2026-10-24/probes.mjs --source-root=/absolute/source/closure`. Default source root is the current repository. The test opens only `:memory:` and never receives credentials/provider ports.
- `preservation.json` verifies all unrelated pre-existing files and 81 protected hashes, with only the explicitly archived tracker changed by planning. `validation.json` checks document links, all eight phase rows, source inventory and zero application edits.
- `linear-sync.json` records actual P5 commit/progress and P6 planning updates. Linear's shared-context endpoint was attempted but returned `Tool get_agent_context not found`; ordinary project/issue tools remained available. Code, saved documents and actual issue state were used.

Full repository tests/build/native checks belong to the committed P5 isolated closure, recorded under [P5 commit evidence](../p5-contest-2026-10-24/commit-isolation/summary.json). They are not presented as validation of P6 application code, trading effectiveness, connected health or qualification. The P6 plan specifies those future acceptance checks and preserves optional sale/connected gates.

**Prompt used**

Commit and push P5-A–G, then lets move on to planning P6. Reread its full requirements in the saved roadmap and inspect the code before coding. Keep P5-H pending and preserve P0–P4 and the full P0–P7 scope.
