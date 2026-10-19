# Evidence index and reproduction

Final application source: `b14da3de77df16821d6042d4c446620bc2af1de5` on the local `codex/oct19-review-integration` branch. Application source hash: `da161324d68a65c1d140ef0a05e493172cb805bcec9f7a675726eac8ccb5ad65`. Evidence/document commits may follow without changing that application tree. No source or artifact was published.

`verification.json` is the check index; `source-identity.json` independently compares tracked application bytes, generated manifest members and build identity. `package.json` contains the embedded packaged identity and SHA-256 of local DMG/ZIP files. `ui/checks.json`, `restore-restart/checks.json` and `news-chain.json` explicitly classify disposable proof. `read-only-inventory.json` is actual Main metadata at its recorded cutoff, without runtime initialization, migration or sealed performance-body access. It does not establish current or external coverage.

`source-0202177/` preserves the earlier complete source's receipts and completed retention run. Other `pre*`, `performance-before*` and shared-browser directories preserve superseded or confounded runs. Read `attempts.md` before comparing measurements. These are evidence history, not alternate final receipts.

## Reproduction on the same matching host

Review all scripts and use generated/disposable data only. Keep actual Main closed and untouched; do not pass actual profile paths or credentials. The native keyring script imports the interface and checks function types only; it never invokes credential operations.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter @coqui/desktop build
pnpm --filter @coqui/adapters test:native-keyring
pnpm --filter @coqui/storage test:native-duckdb
pnpm --filter @coqui/desktop exec electron scripts/smoke.mjs
pnpm --filter @coqui/desktop exec electron scripts/perf.mjs
pnpm --filter @coqui/desktop exec electron scripts/restore-restart-evidence.mjs
pnpm --filter @coqui/desktop exec electron scripts/oct19-ui-evidence.mjs
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @coqui/desktop exec electron-builder --config electron-builder.yml --mac --arm64
pnpm --filter @coqui/desktop exec node scripts/packaged-smoke.mjs
pnpm --filter @coqui/desktop exec node scripts/oct19-performance.mjs
```

Do not run multiple build-producing commands concurrently: Vite clears its output directory. Run benchmarks after builds/package work. Do not rebuild or replace `dist/main/build-info.json` during an active benchmark. The wrapper records identity at launch, and the inner workload reads it at completion; both must match. Keep source fixed for the full elapsed workload.

The custom news-chain and Ionic trace scripts are retained as `news-chain-harness.mjs.txt` and `ionic-trace-harness.mjs.txt`. They were temporary scripts, intentionally outside production source. Their `repository`/`desktop` constants must point to the reviewed checkout; they create throwaway directories and stub network access. Inspect before copying into a temporary `.mjs` file. A copied harness is not authority for actual provider use. The read-only inventory query is documented separately and is not part of normal validation.

## Measurement limits

Fresh browser/session directories isolate application caches; OS file cache is not flushed. Input-to-paint is native pointer dispatch followed by two animation frames, a reproducible proxy rather than a hardware photon timestamp. Event-loop histogram resolution is 20 ms. Forced-GC heap sampling, minute memory snapshots and instrumentation arrays affect retention. The real 30-minute workload uses synthetic 1 Hz updates and does not prove actual-market lag, lower-powered hardware, Windows or every GPU/theme combination. No invented leak threshold is used: raw trends, first/last and tail memory must be reviewed.

Human VoiceOver, representative actual-profile/installed recovery, natural operational news collection, research registration/elapsed coverage, effective branch protections, Windows and release gates remain separate. The main delivery and owner-session documents describe the exact remaining scope.
