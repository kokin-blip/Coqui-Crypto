// electron-builder afterSign hook: ad-hoc code-sign the macOS .app bundle.
//
// This is not cosmetic. `mac.identity: null` skips real Developer-ID signing —
// there is no Apple Developer account, and ADR-0001 defers that as the only
// recommended paid item — but a *completely unsigned* arm64 app fails Apple
// Silicon's kernel-level signature requirement outright. macOS reports it as
// "damaged" and offers only "Move to Trash", with no override.
//
// An ad-hoc signature needs no certificate and satisfies that requirement. The
// app still shows the milder "unidentified developer" prompt on first open,
// which docs/INSTALL.md explains rather than hides.
//
// Structured so adding a real identity later is configuration, not a rewrite:
// set CSC_IDENTITY and mac.identity, and this hook becomes a no-op.
const { execFileSync } = require('node:child_process');

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env['CSC_IDENTITY']) return;
  const appName = context.packager.appInfo.productFilename;
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', `${context.appOutDir}/${appName}.app`],
    { stdio: 'inherit' },
  );
};
