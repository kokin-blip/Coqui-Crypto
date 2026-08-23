// electron-builder afterPack hook: tighten the packaged macOS Info.plist.
//
// Ported from the predecessor at origin/main. Two changes, both narrowing what
// the shipped bundle is permitted to do:
//
//   NSAllowsArbitraryLoads: false — every request this application makes is
//   HTTPS, and the App Transport Security default is permissive enough to allow
//   a plaintext one. Setting it explicitly means a future accidental http:// URL
//   fails at the OS rather than silently succeeding.
//
//   Camera, microphone and Bluetooth usage descriptions removed — Electron's
//   default plist declares them, and a declared capability is one macOS will
//   prompt for. A portfolio tracker has no business asking.
const { execFileSync } = require('node:child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const plist = `${context.appOutDir}/${appName}.app/Contents/Info.plist`;
  execFileSync(
    '/usr/bin/plutil',
    ['-replace', 'NSAppTransportSecurity', '-json', '{"NSAllowsArbitraryLoads":false}', plist],
    { stdio: 'inherit' },
  );
  for (const key of [
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
  ]) {
    try {
      execFileSync('/usr/bin/plutil', ['-remove', key, plist], { stdio: 'ignore' });
    } catch {
      // The desired state is absence, so a missing key is already compliant.
    }
  }
};
