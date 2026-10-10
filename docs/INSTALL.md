# Installing Coqui

Coqui is a local-first desktop application. It stores everything on your own
machine, has no account, no server, and no cloud database.

Two builds are produced: **macOS (Apple Silicon)** and **Windows (x64)**. There
is no Intel Mac build — nothing verifies one, and shipping a binary no test
covers would be a claim this project cannot back.

---

## Before you start: what this application will and will not do

It reads connected Coinbase and Robinhood Crypto portfolios, keeps imported tax
lots as a separate accounting view, computes allocation, and runs a
**paper-trading** research engine.

**It cannot place a real order.** Not "will not by default" — the code path does
not exist. A Coinbase API key that carries trade or transfer permission is
*rejected at connect time*, because the application refuses to hold a key that
could move money. The Robinhood adapter exports read methods only; it has no
real order-placement method.

The paper figures shown beside your real portfolio are a **simulation** and are
labelled as one everywhere they appear.

---

## macOS

### The warning you will see, and why

Coqui is **ad-hoc signed**, not signed with an Apple Developer certificate. A
certificate costs $99 a year and is deferred — it is the only recommended paid
item anywhere in this project's plan.

The practical consequence: on first open, macOS says Coqui **"cannot be opened
because the developer cannot be verified."**

This is worth being precise about, because there are two different macOS
warnings and only one of them is this benign:

| What you see | What it means |
|---|---|
| *"...developer cannot be verified"*, with an **Open** option | Expected. Ad-hoc signed, no Apple certificate. Follow the steps below. |
| *"...is damaged and can't be opened. Move to Trash"*, **no Open option** | Not expected. Do not proceed — the download is corrupt or the build is broken. Check the SHA-256 below, and if it matches, open an issue. |

### Steps

1. Download `Coqui-<version>-mac-arm64.dmg` from the release page.
2. **Verify the download** before opening it:
   ```
   shasum -a 256 ~/Downloads/Coqui-<version>-mac-arm64.dmg
   ```
   Compare against `SHA256SUMS.txt` on the same release page. If it does not
   match, stop.
3. Open the DMG and drag **Coqui** to Applications.
4. In Applications, **right-click Coqui → Open** (not a double-click — the
   right-click path is what offers the override).
5. Click **Open** in the dialog.

You only need step 4 once. After that it launches normally.

### If macOS says the app is damaged

That means the bundle reached you without a valid signature. Do not try to work
around it with `xattr -cr` or by disabling Gatekeeper. Check the checksum first;
if the checksum is correct, the build is at fault and should be reported rather
than bypassed.

---

## Windows

1. Download `Coqui-<version>-win-x64-setup.exe`.
2. **Verify the download**:
   ```
   certutil -hashfile "%USERPROFILE%\Downloads\Coqui-<version>-win-x64-setup.exe" SHA256
   ```
   Compare against `SHA256SUMS.txt`.
3. Run the installer. SmartScreen will warn that the publisher is unknown —
   the same underlying reason as on macOS, and the same trade-off. Click **More
   info → Run anyway** only if the checksum matched.
4. The installer is per-user and lets you choose the location. It will not
   install silently or system-wide.

---

## Where your data lives

| | |
|---|---|
| macOS | `~/Library/Application Support/Coqui/coqui.db` |
| Windows | `%APPDATA%\Coqui\coqui.db` |

These are packaged defaults, not a universal development path. The application
uses Electron's `userData` directory unless `COQUI_DB_PATH` explicitly overrides
the database. Development builds may use `@coqui/desktop` rather than `Coqui`.
Confirm the exact active location in the installed build before recovery.

Storage includes the Main database, additional profile databases,
`wallet-profiles.json`, `coqui-person.json`, and local wallet nicknames. Research
datasets, Parquet archives, immutable reports and referenced files may be outside
the database directory. Keep their manifests and content-addressed directories.
API keys and private keys are **not** in the database — they go to the OS
credential store (Keychain on macOS, Credential Manager on Windows), and never
appear in the database, in a log, in an error message, or in an exported file.

Connections are added in **Settings → Connections**. Coinbase accepts its
view-only credential file. Robinhood Crypto accepts a JSON file containing the
API key and base64 private key created for its Crypto Trading API. The native
file chooser reads either file in the main process; credential contents are
never sent to the screen process. A successful connection performs an
authenticated read-only check before balances become current portfolio data.

Connected balances are the authoritative current portfolio. Imported tax lots
remain available under Portfolio → Accounting for cost basis and reconciliation;
they are not added to connected quantities. If a holding lacks a usable price or
cost basis, Coqui labels it unavailable instead of inventing a value.

Use the existing verified profile-backup machinery for database snapshots. The
application creates consistent SQLite snapshots and verified pre-migration
backups; copying a running WAL database file alone is not a complete backup.
Profile backup verification checks the database checksum, integrity and schema;
it does not by itself certify external archives, ledger equivalence or restore.

Before recovery, preserve the original directory and external evidence. Restore
only into a separate disposable destination with a schema-compatible build.
Check database integrity, foreign keys, exact ledger totals, immutable record
hashes and every required external artifact. Missing/corrupt references make
the restore incomplete. A newer timestamp is not proof that a backup is better.

Credentials are intentionally excluded. The profile backup also does not include
the local person/nickname files or all external archives; preserve required
metadata separately and record omissions. Never copy keychain contents into an
evidence bundle. Reconnection is an explicit owner action.

Do not delete the source database to reset, overwrite an active profile, or open
a migrated database with an older application. Unsupported schema downgrades are
rejected. Failed restore verification leaves the original untouched and the
separate destination quarantined. See the current implementation ledger for
which restore checks have actually been performed.

---

## Uninstalling

- **macOS**: drag Coqui from Applications to the Trash, then delete
  `~/Library/Application Support/Coqui/`.
- **Windows**: Settings → Apps → Coqui → Uninstall, then delete
  `%APPDATA%\Coqui\`.

Neither removes keys from the OS credential store. Disconnect every connection
inside the app first, or remove the `kokincrypto` entries from Keychain Access /
Credential Manager by hand. Disconnecting removes only that profile connection's
current credential. Immutable historical account evidence remains in the local
database for auditability.

---

## When signing changes

If an Apple Developer certificate is ever obtained, the ad-hoc hook becomes a
no-op and the first-open warning disappears. Nothing else about the application
changes, and this document will say so rather than quietly dropping the section.

The local verifier reuses the existing backup manifest/checksum validation:
`node scripts/verify-isolated-restore.mjs --backup /absolute/backup-artifact
--destination /absolute/new-directory-under-system-temp --build-identity VERIFIED_BUILD`.
Supply `--artifacts` with an explicit JSON array of `{ "path": "/absolute/file", "hash": "sha256" }`
for external artifact checks. It refuses existing destinations, incompatible schemas,
foreign-key failures, unbalanced ledger totals and changed hashes. Missing artifacts
remain excluded. It never starts the application, migrates or restores an actual profile,
loads credentials or certifies broker restart. Use only a separately approved disposable
exercise; review the manifest's explicit exclusions before claiming G09.
