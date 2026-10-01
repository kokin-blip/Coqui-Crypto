import { withinDeadline, type RequestDeadline, type createAlpacaPaperClient } from '@coqui/adapters';
import { acquireExecutionLease, getAuthoritativeHost, validateExecutionLease, releaseExecutionLease,
  type Db } from '@coqui/storage';

export function parallelExecutionClaim(profileId: string, hostId: string, db: Db,
  now: () => number, deadline?: RequestDeadline, hostKind?: 'desktop' | 'headless') {
  const authority = getAuthoritativeHost(profileId, db);
  if ((hostKind === 'headless' || hostId.startsWith('headless')) && (authority?.status !== 'active' || authority.hostId !== hostId))
    throw new Error('stale_host_authority');
  if (authority?.status === 'active' && authority.hostId !== hostId) throw new Error('stale_host_authority');
  const generation = authority?.fencingGeneration ?? 0;
  const lease = acquireExecutionLease(profileId, hostId, now(), 30_000, db);
  if (!lease) throw new Error('execution_lease_unavailable');
  return {
    check() {
      deadline?.check();
      const current = getAuthoritativeHost(profileId, db);
      if ((current?.fencingGeneration ?? 0) !== generation ||
          !validateExecutionLease(profileId, hostId, lease.fencingToken, now(), db)) throw new Error('stale_host_authority');
    },
    release() { releaseExecutionLease(profileId, hostId, lease.fencingToken, now(), db); },
  };
}

type Client = ReturnType<typeof createAlpacaPaperClient>;
/** Capture only operation outcomes, never credential values or raw broker bodies. */
export function observedParallelClient(client: Client, now: () => number, append:
  (kind: string, key: string, detail: Record<string, unknown>) => void, deadline?: RequestDeadline, keyPrefix = 'read'): Client {
  let sequence = 0;
  return new Proxy(client, { get(target, property) {
    const method = Reflect.get(target, property) as unknown;
    if (typeof method !== 'function') return method;
    return async (...args: unknown[]) => {
      deadline?.check();
      const startedAtMs = now(), started = performance.now(), operation = String(property);
      const key = `readiness:${keyPrefix}:${startedAtMs}:${operation}:${sequence++}`;
      try {
        const result: unknown = await withinDeadline(Reflect.apply(method, target, args) as Promise<unknown>, deadline);
        deadline?.check();
        append('readiness', key, { operation, status: 'received', startedAtMs, observedAtMs: now(),
          durationMs: performance.now() - started });
        return result;
      } catch (error) {
        append('readiness', key, { operation, status: 'unavailable', startedAtMs, observedAtMs: now(),
          durationMs: performance.now() - started,
          reason: error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : 'broker_read_failed' });
        throw error;
      }
    };
  } });
}
