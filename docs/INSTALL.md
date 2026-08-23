# Installing Coqui

Coqui is a local-first desktop application. It stores everything on your own
machine, has no account, no server, and no cloud database.

Two builds are produced: **macOS (Apple Silicon)** and **Windows (x64)**. There
is no Intel Mac build — nothing verifies one, and shipping a binary no test
covers would be a claim this project cannot back.

---

## Before you start: what this application will and will not do

It reads your Coinbase portfolio, tracks tax lots, computes allocation, and runs
a **paper-trading** research engine.

**It cannot place a real order.** Not "will not by default" — the code path does
not exist. A Coinbase API key that carries trade or transfer permission is
*rejected at connect time*, because the application refuses to hold a key that
could move money.

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

One SQLite file. API keys are **not** in it — they go to the OS credential store
(Keychain on macOS, Credential Manager on Windows), and never appear in the
database, in a log, in an error message, or in an exported file.

To back up, quit Coqui and copy that file. To start over, quit and delete it.

---

## Uninstalling

- **macOS**: drag Coqui from Applications to the Trash, then delete
  `~/Library/Application Support/Coqui/`.
- **Windows**: Settings → Apps → Coqui → Uninstall, then delete
  `%APPDATA%\Coqui\`.

Neither removes keys from the OS credential store. Disconnect any connected key
inside the app first, or remove the `kokincrypto` entries from Keychain
Access / Credential Manager by hand.

---

## When signing changes

If an Apple Developer certificate is ever obtained, the ad-hoc hook becomes a
no-op and the first-open warning disappears. Nothing else about the application
changes, and this document will say so rather than quietly dropping the section.
