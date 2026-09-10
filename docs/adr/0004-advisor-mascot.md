# ADR-0004 — Bound personification to the operations workspace

**Status:** AMENDED
**Date:** 2026-08-01
**Amended:** 2026-09-09

## Decision

Do not migrate `SpriteAnim`, `WalkAround`, `BotBuddy`, their Python build script,
or autonomous mascot behavior. The dedicated Operations workspace may use six
code-native, decorative subsystem robots: Coqui, Scout, Darwin, Guard, Courier,
and Advisor. They share a compact mechanical design language and use distinct
role accessories.

Each illustration is paired with one bounded persisted read model. State,
timestamps, progress, conclusions, and evidence identities come from those read
models; the character cannot imply health, activity, or reasoning. Missing
evidence renders as unavailable. Courier represents routing and paper execution
together, and Advisor represents explanation and allowlisted navigation.

## Reason

Application-wide animated mascots add packaging and attention costs without
supporting portfolio correctness, research validity, or paper-trading safety.
A restrained operations roster improves subsystem recognition while leaving the
recorded evidence visibly authoritative.

## Consequences

- General Advisor chat remains a functional evidence surface, not an animated
  mascot experience.
- Illustrations are hidden from assistive technology because their name and
  state are already present as text, and cannot create or mutate operational state.
- Restrained CSS motion may mirror the recorded state (for example blink,
  signal, or attention). It must stop in reduced/no-motion modes. Hidden-reasoning
  simulation, synthetic terminal noise, and character-authored telemetry remain forbidden.
- Any future interactive or autonomous character behavior requires a new ADR and
  must not expand the research, credential, routing, or execution boundaries.
