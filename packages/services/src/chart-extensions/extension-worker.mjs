/* global WebAssembly */
import { parentPort, workerData } from 'node:worker_threads';

async function run() {
  const module = await WebAssembly.compile(new Uint8Array(workerData.wasm).slice().buffer);
  if (WebAssembly.Module.imports(module).length !== 0) throw new Error('imports_forbidden');
  const instance = await WebAssembly.instantiate(module, {});
  const transform = instance.exports.transform;
  if (typeof transform !== 'function') throw new Error('transform_missing');
  const memory = instance.exports.memory;
  if (memory !== undefined && memory.buffer.byteLength > 1_048_576) throw new Error('memory_limit');
  const values = workerData.closes.map((close, index) => Number(transform(close, index)));
  if (values.some((value) => !Number.isFinite(value))) throw new Error('malformed_output');
  parentPort?.postMessage({ ok: true, values });
}

void run().catch((error) => parentPort?.postMessage({
  ok: false,
  code: error instanceof Error ? error.message : 'extension_failed',
}));
