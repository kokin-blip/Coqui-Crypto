import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { generateInput, runTypeScriptKernel } from './kernel.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const repetitions = Number.parseInt(process.env.COQUI_BENCH_REPETITIONS ?? '20', 10);
const requestedBackends = new Set((process.env.COQUI_BENCH_BACKENDS ?? 'typescript,rust-napi,python-numpy-worker').split(','));
const bootstrapResamples = Number.parseInt(process.env.COQUI_BENCH_BOOTSTRAPS ?? '5000', 10);
const pythonPath = process.env.COQUI_PYTHON ?? join(directory, '.venv', 'Scripts', 'python.exe');
const pythonWorkerPath = join(directory, 'python', 'worker.py');
const rustPath = join(directory, 'rust', 'coqui_research_kernel.win32-x64-msvc.node');

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

function outputHash(output) {
  return createHash('sha256').update(JSON.stringify(output)).digest('hex');
}

function canonicalHeader(input) {
  return {
    schemaVersion: input.schemaVersion,
    assetCount: input.assetCount,
    dayCount: input.dayCount,
    candidateCount: input.candidateCount,
    warmup: input.warmup,
    bootstrapResamples: input.bootstrapResamples,
    seed: input.seed,
  };
}

async function write(stream, buffer) {
  if (!stream.write(buffer)) await once(stream, 'drain');
}

class BufferedReader {
  #buffer = Buffer.alloc(0);
  #ended = false;
  #waiting = [];

  constructor(stream) {
    stream.on('data', (chunk) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#settle();
    });
    stream.on('end', () => {
      this.#ended = true;
      this.#settle();
    });
  }

  read(size) {
    return new Promise((resolve, reject) => {
      this.#waiting.push({ size, resolve, reject });
      this.#settle();
    });
  }

  #settle() {
    while (this.#waiting.length > 0) {
      const next = this.#waiting[0];
      if (this.#buffer.length < next.size) {
        if (this.#ended) {
          this.#waiting.shift();
          next.reject(new Error('python_worker_ended'));
          continue;
        }
        return;
      }
      this.#waiting.shift();
      const result = this.#buffer.subarray(0, next.size);
      this.#buffer = this.#buffer.subarray(next.size);
      next.resolve(result);
    }
  }
}

function createTypeScriptBackend() {
  return {
    name: 'typescript',
    loadMs: 0,
    async run(input) {
      const started = performance.now();
      const output = runTypeScriptKernel(input);
      return { output, invocationMs: performance.now() - started, conversionMs: 0, decodingMs: 0 };
    },
    async close() {},
  };
}

function createRustBackend() {
  const loadStarted = performance.now();
  const require = createRequire(import.meta.url);
  const { runKernel } = require(join(directory, 'rust'));
  const loadMs = performance.now() - loadStarted;
  return {
    name: 'rust-napi',
    loadMs,
    async run(input) {
      const invoked = performance.now();
      const encoded = runKernel(input.closes, input.schemaVersion, input.assetCount, input.dayCount,
        input.candidateCount, input.warmup, input.bootstrapResamples, input.seed);
      const invocationMs = performance.now() - invoked;
      const decodingStarted = performance.now();
      const output = JSON.parse(encoded);
      return { output, invocationMs, conversionMs: 0, decodingMs: performance.now() - decodingStarted };
    },
    async close() {},
  };
}

async function createPythonBackend() {
  const loadStarted = performance.now();
  const child = spawn(pythonPath, [pythonWorkerPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1' },
    windowsHide: true,
  });
  const reader = new BufferedReader(child.stdout);
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await Promise.race([
    new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('python_worker_start_timeout')), 10_000)),
  ]);
  const loadMs = performance.now() - loadStarted;
  return {
    name: 'python-numpy-worker',
    loadMs,
    async run(input) {
      const conversionStarted = performance.now();
      const header = Buffer.from(JSON.stringify(canonicalHeader(input)));
      const headerLength = Buffer.allocUnsafe(4);
      headerLength.writeUInt32LE(header.length);
      const closes = Buffer.from(input.closes.buffer, input.closes.byteOffset, input.closes.byteLength);
      const frameLength = Buffer.allocUnsafe(4);
      frameLength.writeUInt32LE(headerLength.length + header.length + closes.length);
      const conversionMs = performance.now() - conversionStarted;
      const invoked = performance.now();
      await write(child.stdin, Buffer.concat([frameLength, headerLength, header, closes]));
      const responseLength = (await reader.read(4)).readUInt32LE();
      const response = await reader.read(responseLength);
      const invocationMs = performance.now() - invoked;
      const decodingStarted = performance.now();
      const output = JSON.parse(response.toString('utf8'));
      return { output, conversionMs, invocationMs, decodingMs: performance.now() - decodingStarted };
    },
    async close() {
      child.stdin.end();
      await once(child, 'exit');
      if (child.exitCode !== 0) throw new Error(`python_worker_failed:${stderr.trim()}`);
    },
  };
}

async function measure(backend, input, expected) {
  const times = [];
  const invocations = [];
  const conversions = [];
  const decodings = [];
  const hashes = [];
  let parity = true;
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    const started = performance.now();
    const result = await backend.run(input);
    times.push(performance.now() - started);
    invocations.push(result.invocationMs);
    conversions.push(result.conversionMs);
    decodings.push(result.decodingMs);
    hashes.push(outputHash(result.output));
    parity &&= JSON.stringify(result.output) === JSON.stringify(expected);
  }
  return {
    parity,
    repeatedHash: new Set(hashes).size === 1,
    outputHash: hashes[0],
    repetitions,
    endToEndMs: { p50: percentile(times, 0.5), p95: percentile(times, 0.95) },
    invocationMs: { p50: percentile(invocations, 0.5), p95: percentile(invocations, 0.95) },
    conversionMs: { p50: percentile(conversions, 0.5), p95: percentile(conversions, 0.95) },
    decodingMs: { p50: percentile(decodings, 0.5), p95: percentile(decodings, 0.95) },
  };
}

async function verifyFailures(backends, input) {
  const malformed = { ...input, dayCount: input.dayCount + 1 };
  const invalidPrices = { ...input, closes: input.closes.slice() };
  invalidPrices.closes[7] = Number.NaN;
  const cases = [['invalid_dimensions', malformed], ['invalid_price', invalidPrices]];
  const results = {};
  for (const backend of backends) {
    results[backend.name] = [];
    for (const [code, fixture] of cases) {
      const { output } = await backend.run(fixture);
      results[backend.name].push(output.ok === false && output.code === code);
    }
  }
  return results;
}

const input = Object.freeze({ ...generateInput(), bootstrapResamples });
const inputHashBefore = createHash('sha256').update(Buffer.from(input.closes.buffer)).digest('hex');
const backends = [];
if (requestedBackends.has('typescript')) backends.push(createTypeScriptBackend());
if (requestedBackends.has('rust-napi')) backends.push(createRustBackend());
if (requestedBackends.has('python-numpy-worker')) backends.push(await createPythonBackend());
try {
  const expected = runTypeScriptKernel(input);
  const failures = await verifyFailures(backends, input);
  const measurements = {};
  for (const backend of backends) measurements[backend.name] = await measure(backend, input, expected);
  const inputHashAfter = createHash('sha256').update(Buffer.from(input.closes.buffer)).digest('hex');
  const [rustArtifact, workerSource] = await Promise.all([stat(rustPath), stat(pythonWorkerPath)]);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    workload: canonicalHeader(input),
    environment: {
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
      rustArtifactBytes: rustArtifact.size,
      pythonWorkerBytes: workerSource.size,
      loadMs: Object.fromEntries(backends.map((backend) => [backend.name, backend.loadMs])),
      repetitions,
      implicitParallelism: 'disabled',
    },
    inputDetached: inputHashBefore === inputHashAfter,
    failures,
    measurements,
    qualification: {
      productionGoldenParity: false,
      macosArm64LoadParity: false,
      promotionAllowed: false,
      reason: 'language_spike_is_quarantined_and_does_not_execute_the_registered_production_contract',
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await Promise.all(backends.map((backend) => backend.close()));
}
