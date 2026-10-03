import type { HttpClient, HttpRequestInit } from './client.js';

const researchDeadlines = new Set<RequestDeadline>();

/** One preparation/execution budget. Wall time catches suspend; monotonic time measures work. */
export interface RequestDeadline {
  readonly signal: AbortSignal;
  readonly expiresAtMs: number;
  remainingMs(): number;
  check(): void;
  dispose(): void;
}

export function createRequestDeadline(now: () => number, durationMs = 30_000,
  windowEndMs = Number.MAX_SAFE_INTEGER, elapsedNow: () => number = () => performance.now()): RequestDeadline {
  for (const research of researchDeadlines) research.dispose();
  researchDeadlines.clear();
  const started = elapsedNow(), expiresAtMs = Math.min(now() + durationMs, windowEndMs);
  const controller = new AbortController();
  const remainingMs = () => controller.signal.aborted ? 0 : Math.max(0, Math.min(expiresAtMs - now(), durationMs - (elapsedNow() - started)));
  const timer = setTimeout(() => controller.abort(), remainingMs());
  timer.unref?.();
  return { signal: controller.signal, expiresAtMs, remainingMs,
    check() { if (controller.signal.aborted || remainingMs() <= 0) { controller.abort(); throw new Error('deadline_exceeded'); } },
    dispose() { clearTimeout(timer); controller.abort(); } };
}

/** A child budget never preempts research or extends its parent's lifetime. */
export function childRequestDeadline(parent: RequestDeadline, durationMs: number): RequestDeadline {
  const started = performance.now(), controller = new AbortController();
  const remainingMs = () => controller.signal.aborted || parent.signal.aborted ? 0 : Math.max(0, Math.min(parent.remainingMs(), durationMs - (performance.now() - started)));
  const signal = AbortSignal.any([parent.signal, controller.signal]);
  const timer = setTimeout(() => controller.abort(), remainingMs()); timer.unref?.();
  return { signal, expiresAtMs: parent.expiresAtMs - Math.max(0, parent.remainingMs() - durationMs), remainingMs,
    check() { if (signal.aborted || remainingMs() <= 0) { controller.abort(); throw new Error('deadline_exceeded'); } },
    dispose() { clearTimeout(timer); controller.abort(); } };
}

export function deadlineHttp(http: HttpClient, deadline: RequestDeadline,
  priority: 'execution' | 'research' = 'execution'): HttpClient {
  const init = (value?: HttpRequestInit): HttpRequestInit => {
    deadline.check();
    return { ...value, maxElapsedMs: Math.min(value?.maxElapsedMs ?? Infinity, deadline.remainingMs()), requestPriority: priority,
      signal: value?.signal ? AbortSignal.any([value.signal, deadline.signal]) : deadline.signal };
  };
  return { getJson: (url, value) => http.getJson(url, init(value)),
    postJson: (url, body, value) => http.postJson(url, body, init(value)),
    getText: (url, value) => http.getText(url, init(value)),
    ...(http.getBytes ? { getBytes: (url: string, value?: HttpRequestInit) => http.getBytes!(url, init(value)) } : {}),
    destroy() { /* The shared transport belongs to the composition root. */ } };
}

export function createResearchDeadline(now: () => number): RequestDeadline {
  const controller = new AbortController(), expiresAtMs = now() + 10_000, started = performance.now();
  const remainingMs = () => controller.signal.aborted ? 0 : Math.max(0, Math.min(expiresAtMs - now(), 10_000 - (performance.now() - started)));
  const timer = setTimeout(() => controller.abort(), 10_000); timer.unref?.();
  const deadline: RequestDeadline = { expiresAtMs, signal: controller.signal, remainingMs,
    check() { if (controller.signal.aborted || remainingMs() <= 0) { controller.abort(); throw new Error('research_budget_exhausted'); } },
    dispose() { clearTimeout(timer); controller.abort(); researchDeadlines.delete(deadline); } };
  researchDeadlines.add(deadline); return deadline;
}

/** Bound non-cancellable reads too; their late results cannot resume the expired execution pass. */
export async function withinDeadline<T>(operation: Promise<T>, deadline?: RequestDeadline): Promise<T> {
  if (!deadline) return operation;
  deadline.check();
  let remove = () => {};
  const expired = new Promise<never>((_resolve, reject) => {
    const fail = () => reject(new Error('deadline_exceeded'));
    if (deadline.signal.aborted) { fail(); return; }
    deadline.signal.addEventListener('abort', fail, { once: true });
    remove = () => deadline.signal.removeEventListener('abort', fail);
  });
  try { const result = await Promise.race([operation, expired]); deadline.check(); return result; }
  finally { remove(); }
}

export function deadlineReadHttp(client: Pick<HttpClient, 'getJson' | 'destroy'>, deadline: RequestDeadline,
  requestPriority: 'execution' | 'research' = 'execution'): Pick<HttpClient, 'getJson' | 'destroy'> {
  return { getJson: (url, init) => {
    deadline.check();
    return withinDeadline(client.getJson(url, { ...init, maxElapsedMs: Math.min(init?.maxElapsedMs ?? Infinity, deadline.remainingMs()),
      requestPriority, signal: init?.signal ? AbortSignal.any([init.signal, deadline.signal]) : deadline.signal }), deadline);
  }, destroy: () => client.destroy() };
}
