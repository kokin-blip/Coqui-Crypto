# ADR-0004 — Exclude the advisor mascot from the initial migration

**Status:** ACCEPTED
**Date:** 2026-08-01

## Decision

Do not migrate `SpriteAnim`, `WalkAround`, `BotBuddy`, sprite assets, or their
Python build script into the initial Coqui user experience.

## Reason

The subsystem adds animation, packaging, and asset-generation complexity without
supporting portfolio correctness, research validity, or paper-trading safety.
The advisor's useful explanatory content may be migrated independently.

## Consequences

- Phase 5 starts with the strategy scoreboard and functional portfolio surfaces.
- A future mascot requires a new UX decision and must not expand the Python
  research boundary.
