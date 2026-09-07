import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(dirname(desktopRoot));
const rendererUrl = 'http://127.0.0.1:5173';
const children = new Set();

function child(command, args, options = {}) {
  const process = spawn(command, args, {
    cwd: workspaceRoot,
    stdio: 'inherit',
    ...options,
  });
  children.add(process);
  process.once('exit', () => children.delete(process));
  return process;
}

function stop(signal = 'SIGTERM') {
  for (const process of children) process.kill(signal);
}

async function waitForRenderer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await new Promise((resolve) => {
      const probe = request(rendererUrl, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      probe.once('error', () => resolve(false));
      probe.setTimeout(500, () => {
        probe.destroy();
        resolve(false);
      });
      probe.end();
    });
    if (ready) return;
    await setTimeout(100);
  }
  throw new Error('Vite renderer did not become ready within 30 seconds.');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stop(signal);
    process.exit(0);
  });
}

const build = child('pnpm', ['--filter', '@coqui/desktop', 'build']);
const buildExit = await new Promise((resolve) => build.once('exit', resolve));
if (buildExit !== 0) process.exit(Number(buildExit ?? 1));

child('pnpm', ['--filter', '@coqui/desktop', 'dev']);
try {
  await waitForRenderer();
} catch (error) {
  stop();
  throw error;
}

const debugPort = process.env['KOKINCRYPTO_DEBUG_PORT'];
const electronArgs = [
  ...(debugPort === undefined ? [] : [`--remote-debugging-port=${debugPort}`]),
  '.',
];
const electron = child(join(desktopRoot, 'node_modules', '.bin', 'electron'), electronArgs, {
  cwd: desktopRoot,
  env: { ...process.env, ELECTRON_RENDERER_URL: rendererUrl },
});
const exitCode = await new Promise((resolve) => electron.once('exit', resolve));
stop();
process.exit(Number(exitCode ?? 0));
