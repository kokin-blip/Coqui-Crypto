import { parentPort, workerData } from 'node:worker_threads';

interface Input { readonly wasm: Uint8Array; readonly closes: readonly number[] }

async function run(): Promise<void> {
  const input = workerData as Input;
  const wasm = (globalThis as unknown as { readonly WebAssembly: {
    compile(bytes: ArrayBuffer): Promise<unknown>;
    Module: { imports(module: unknown): readonly unknown[] };
    instantiate(module: unknown, imports: object): Promise<{ readonly exports: Record<string, unknown> }>;
  } }).WebAssembly;
  const module = await wasm.compile(new Uint8Array(input.wasm).slice().buffer);
  if (wasm.Module.imports(module).length !== 0) throw new Error('imports_forbidden');
  const instance = await wasm.instantiate(module, {});
  const exported = instance.exports['transform'];
  if (typeof exported !== 'function') throw new Error('transform_missing');
  const memory = instance.exports['memory'];
  if (memory !== null && typeof memory === 'object' && 'buffer' in memory &&
    (memory as { readonly buffer: ArrayBuffer }).buffer.byteLength > 1_048_576) {
    throw new Error('memory_limit');
  }
  const values = input.closes.map((close, index) => Number(exported(close, index)));
  if (values.some((value) => !Number.isFinite(value))) throw new Error('malformed_output');
  parentPort?.postMessage({ ok: true, values });
}

void run().catch((error: unknown) => parentPort?.postMessage({
  ok: false, code: error instanceof Error ? error.message : 'extension_failed',
}));
