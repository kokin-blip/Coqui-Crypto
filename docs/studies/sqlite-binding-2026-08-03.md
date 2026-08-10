# SQLite binding evaluation — 2026-08-03

## Outcome

Select built-in `node:sqlite` for operational persistence. It passed the
predecessor migration, transactional rollback, backup/restore, fixed-point text,
and exact 64-bit integer gates. Keep all money columns that participate in new
orders, fills, balances, ledgers, portfolio records, and risk peaks as decimal
`TEXT`; use per-statement `setReadBigInts(true)` when an SQLite integer may
exceed JavaScript's safe range.

## Runtime findings

- Node 24.18 documents `node:sqlite` at stability 1.2 (release candidate), with
  synchronous `DatabaseSync`, transaction state, configurable `bigint` reads,
  and SQLite backup support.
- Electron 35.7.5 embeds Node 22.16 and is out of support. It cannot satisfy the
  project's Node 24 runtime contract.
- Current Electron 42 stable releases embed Node 24.18, so the Phase 5 shell can
  use the built-in binding without a native addon.
- `better-sqlite3` remains capable and mature, but it adds an Electron-specific
  native binary and rebuild/packaging surface that this application does not
  otherwise need.

Primary references:

- <https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html>
- <https://releases.electronjs.org/release/v35.7.5>
- <https://releases.electronjs.org/release?channel=stable>
- <https://github.com/WiseLibs/better-sqlite3>
- <https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md>

## Local compatibility campaign

`tests/storage-migrations.test.ts` proves:

1. the predecessor's versions and names remain 1–28 without renumbering;
2. a fresh database produces the expected version-33 schema;
3. every schema version 1–32 upgrades with row preservation;
4. fixed-point decimal text and a 64-bit identifier round-trip exactly;
5. a version-17 backup opens independently with its original rows and version;
6. a failing forward migration is fully transactional; and
7. reordered, gapped, or future schemas fail closed.

Packaged Windows and macOS validation remains a Phase 5 release gate because the
desktop shell is not yet implemented.
