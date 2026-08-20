# `node:sqlite` under the Electron main process — 2026-08-20

## Outcome

ADR-0003's runtime assumption holds. Electron 43.4.1 exposes `node:sqlite` in the
main process and Coqui's full forward-only migration manifest applies cleanly
inside it. The P5 shell can be built directly on `packages/storage` with no
native addon and no second binding.

This retires the dev-mode half of ADR-0003's risk. The packaged Windows x64 and
macOS arm64 smoke tests named in that ADR's "Remaining distribution gate" are
**still outstanding** and remain a P9 release gate.

## Why this was run first

`docs/adr/0003-sqlite-binding.md` was accepted on 2026-08-03 against
documentation and against Electron 42 release notes, not against an executed
Electron process — the desktop shell did not exist and still does not.
`packages/storage/src/sqlite/connection.ts` imports `DatabaseSync` from
`node:sqlite` directly, so every repository, every profile database, and the
whole P5 composition root depend on an availability claim that had never been
executed. A failure here would have reopened the ADR after the shell was built
on top of it, so it was measured before Stage 1 rather than during Stage 2.

## Method

A throwaway Electron main process outside the repository, run against the
repository's own built `packages/storage/dist/sqlite/index.js` so the real
migration manifest executed rather than a reconstruction of it.

Checks, in order: `import('node:sqlite')` resolves and yields a `DatabaseSync`
constructor; open a file database; `PRAGMA journal_mode = WAL`; create a table;
`BEGIN` / insert / `COMMIT`; read the value back; set and re-read
`PRAGMA user_version`; then call the package's own `openDatabase()` against a
fresh path and inspect the resulting schema version and table count.

## Results

| Check | Result |
|---|---|
| Electron version | 43.4.1 |
| Bundled Node version | 24.18.1 — satisfies the ADR's Node 24 runtime contract |
| Bundled Chromium | 150.0.7871.224 |
| `import('node:sqlite')` in main | present, `DatabaseSync` is a function |
| open / WAL / DDL / transaction / read-back | passed; fixed-point text `0.00000001` round-tripped exactly |
| `PRAGMA user_version` round-trip | passed, returned as `number` |
| `openDatabase()` with the real manifest | passed — `user_version=44`, 80 tables created |

All seven checks passed.

## Consequences

- Electron 43.x is the runtime floor for the shell, above ADR-0003's stated
  Electron 42 minimum. Pin it under `docs/dependency-policy.md` when the shell
  package gains the dependency.
- `PRAGMA user_version` returned a `number` here, but
  `packages/storage/src/sqlite/connection.ts` already accepts either `number` or
  `bigint`. Keep that tolerance; it is not dead code.
- The migration manifest was exercised from a build artifact, not from `src`.
  That is the same path a packaged application takes, which is the point.
- Renderer-side behaviour was not tested and does not need to be. Under
  `contextIsolation` with `sandbox: true` the renderer has no database access by
  design; storage is reachable only through the main process.

## Not yet proven

Packaged-application behaviour under `electron-builder` on macOS arm64 and
Windows x64, including ASAR packing and code-signing effects on the built-in
module. That is the P9 distribution gate and this study does not discharge it.
