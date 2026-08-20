# ADR-0003 — Use the built-in `node:sqlite` binding

**Status:** ACCEPTED
**Date:** 2026-08-03

## Decision

Use Node's built-in synchronous `node:sqlite` API for the operational SQLite
database. Require a Node 24-based application runtime. The eventual Electron
shell must therefore use Electron 42 or newer; the predecessor's Electron 35
runtime is not compatible with this decision and is already out of support.

The 28 predecessor migrations retain their exact versions, names, and SQL. They
are split into four files only to satisfy the repository's 500-line limit.
Forward upgrades run in one `BEGIN IMMEDIATE` transaction and create a
`VACUUM INTO` backup before changing an existing file database. Coqui-native
forward migrations begin at version 29 and do not modify or renumber that
history.

## Evidence

- Migration tests start at every schema version 1 through 32 and reach version
  33 while preserving an exact fixed-point text value and an
  integer beyond JavaScript's safe-number range.
- `StatementSync.setReadBigInts(true)` round-trips 64-bit identifiers exactly.
- A file database at version 17 produces a restorable pre-migration backup whose
  rows and `user_version` remain unchanged.
- An injected version-34 failure rolls back its table and leaves
  `user_version = 33`.
- The manifest rejects gaps, reordering, renumbering, and databases newer than
  the application understands.

See `docs/studies/sqlite-binding-2026-08-03.md`.

## Reason

`node:sqlite` now supplies the synchronous prepared statements, explicit
transactions, configurable `bigint` reads, and backup primitives this local,
single-writer desktop application needs. It removes the native-addon rebuild,
Electron ABI, and packaging friction carried by `better-sqlite3` without
changing the SQLite file format or migration SQL.

The API is a release candidate rather than fully stable in Node 24, so the
binding remains behind `packages/storage/src/sqlite`. A future change can replace
that adapter without changing core, services, repositories, or the schema.

## Runtime confirmation — 2026-08-20

The availability claim above was accepted against documentation and release
notes, not against an executed Electron process. It has now been measured.
Electron 43.4.1 (Node 24.18.1) exposes `node:sqlite` in the main process, and
this repository's built migration manifest applies inside it to
`user_version = 44` across 80 tables, with fixed-point decimal text preserved
exactly. Electron 43.x, not the originally stated 42, is the runtime floor.

See `docs/studies/electron-node-sqlite-2026-08-20.md`.

## Remaining distribution gate

Packaged Windows x64 and macOS arm64 smoke tests under the selected Electron
runtime are still required, including ASAR packing and code-signing effects on
the built-in module. The 2026-08-20 confirmation above covers the development
runtime only and does not discharge this gate, which moves to P9 with the rest
of distribution. A packaged-build failure reopens this ADR; it does not justify
silently falling back to a second binding.
