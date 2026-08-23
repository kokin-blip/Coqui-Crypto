// ADR-0003's gate, run against the packaged application.
//
// The unpackaged smoke proves the code works. This proves the *artifact* works,
// which is a different claim: `node:sqlite` has to open a migrated database
// from inside an asar-packed, ad-hoc-signed bundle, and the two native modules
// have to load from outside that archive. A failure here reopens ADR-0003; it
// does not justify adding a second SQLite binding.
//
// Run after `pnpm --filter @coqui/desktop package:mac` (or `:win`).
//
//   node scripts/packaged-smoke.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const release = join(root, 'release');

const checks = [];
function check(name, passed, detail = '') {
  checks.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

/** The packaged executable, whichever platform produced it. */
function locateApp() {
  if (!existsSync(release)) return null;
  for (const entry of readdirSync(release)) {
    const macApp = join(release, entry, 'Coqui.app', 'Contents', 'MacOS', 'Coqui');
    if (existsSync(macApp)) return { platform: 'darwin', executable: macApp, bundle: join(release, entry, 'Coqui.app') };
    const winApp = join(release, entry, 'Coqui.exe');
    if (existsSync(winApp)) return { platform: 'win32', executable: winApp, bundle: join(release, entry) };
  }
  return null;
}

const app = locateApp();
if (app === null) {
  console.log('FAIL  no packaged application found — run package:mac or package:win first');
  process.exit(1);
}
check('packaged application located', true, app.executable.replace(root, '.'));

// An unsigned arm64 bundle is reported as "damaged" by macOS with no override,
// so the ad-hoc signature is load-bearing rather than cosmetic.
if (app.platform === 'darwin') {
  // `codesign -dv` reports on *stderr* and exits 0, so both streams are read.
  const signed = spawnSync('codesign', ['-dv', app.bundle], { encoding: 'utf8' });
  const signature = `${signed.stdout ?? ''}${signed.stderr ?? ''}`;
  check(
    'bundle carries an ad-hoc signature',
    signature.includes('adhoc'),
    'Apple Silicon refuses an unsigned bundle outright',
  );

  const plist = join(app.bundle, 'Contents', 'Info.plist');
  const readKey = (key) => {
    // An absent key is the expected result for the stripped ones, so plutil's
    // complaint about it is noise rather than a finding.
    const read = spawnSync('/usr/bin/plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' });
    return read.status === 0 ? String(read.stdout).trim() : null;
  };
  check(
    'arbitrary loads are denied',
    readKey('NSAppTransportSecurity.NSAllowsArbitraryLoads') === 'false',
    'afterPackHardening',
  );
  for (const key of ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription']) {
    check(`${key} stripped`, readKey(key) === null, 'a declared capability is one macOS will prompt for');
  }
}

// The gate itself. `--packaged-smoke` makes the main process open a database in
// a throwaway directory, report the schema version, and exit — without opening
// a window, so this runs headless in CI.
const dataDir = mkdtempSync(join(tmpdir(), 'coqui-packaged-'));
const run = spawnSync(app.executable, ['--packaged-smoke', `--user-data-dir=${dataDir}`], {
  encoding: 'utf8',
  timeout: 120_000,
  env: { ...process.env, COQUI_DATA_DIR: dataDir },
});

const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const reported = /COQUI_PACKAGED_SMOKE (\{.*\})/u.exec(output);
let result = null;
if (reported !== null) {
  try {
    result = JSON.parse(reported[1]);
  } catch {
    result = null;
  }
}

check('packaged process ran the smoke and exited', run.status === 0, `exit=${run.status}`);
check('node:sqlite opened a database under asar', result?.opened === true, output.slice(-300).trim());
check(
  'migrations applied inside the package',
  typeof result?.schemaVersion === 'number' && result.schemaVersion > 0,
  `user_version=${result?.schemaVersion}`,
);

rmSync(dataDir, { recursive: true, force: true });

console.log('\n=== PACKAGED SMOKE (ADR-0003 gate) ===');
const failures = checks.filter((entry) => !entry.passed).length;
console.log(`=== ${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
