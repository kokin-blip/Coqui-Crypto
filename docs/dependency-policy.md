# Dependency policy

- Runtime dependencies are added only when a phase requires them.
- Lockfile changes are reviewed with their release notes and audit output.
- GitHub Actions are pinned to immutable commit SHAs.
- Native dependencies must be exercised in both Node and packaged Electron CI.
- `keytar` is archived and must not be added. Phase 2 selected pinned
  `@napi-rs/keyring` 1.3.0 through its asynchronous keytar-compatible facade so
  existing service/account entries remain readable. Secure-storage absence fails
  closed; there is no plaintext or database fallback.
- The keyring native binary is load-tested without credential access on Windows,
  macOS, and Linux CI. The same smoke test must be added to packaged-Electron CI
  when Phase 5 introduces the packaging job; packaging cannot ship before it is.
- Weekly Dependabot checks cover npm and GitHub Actions; the audit workflow fails
  on high or critical production vulnerabilities.
- N8 pins `fflate` 0.8.3 exactly in `packages/adapters` for cross-platform ZIP
  extraction. It is pure JavaScript with no transitive runtime dependencies;
  its install passed supply-chain policy and a production audit on 2026-08-04.
- N7 pins the official `@duckdb/node-api` 1.5.5-r.3 in `packages/storage` for
  Parquet writing and read-only analytical queries. It ships platform-native
  bindings, so CI loads it and executes an in-memory query on Windows, macOS,
  and Linux. Packaged-Electron loading remains a Phase 5 distribution gate. The
  install passed supply-chain policy and `pnpm audit --prod` reported no known
  vulnerabilities on 2026-08-04.
