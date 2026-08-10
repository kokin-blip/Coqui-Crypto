import { describe, expect, it, vi } from 'vitest';

import {
  REDACTED,
  createStructuredLogger,
  type StructuredLogEntry,
} from '../packages/observability/src/index.js';

describe('structured logger', () => {
  it('recursively removes secrets, credentials, URLs, payloads, and unsafe error data', () => {
    const secret = 'canary-secret-value-928374';
    const entries: StructuredLogEntry[] = [];
    const cyclic: Record<string, unknown> = { safe: 'retained' };
    cyclic['self'] = cyclic;
    const error = new Error(`provider rejected ${secret}`, {
      cause: new Error('Bearer abc.def.ghi'),
    });
    const logger = createStructuredLogger({
      sink: (entry) => entries.push(entry),
      secrets: [secret],
      timestamp: () => '2026-08-04T00:00:00.000Z',
    });

    logger.info('security.redaction_checked', {
      apiKey: secret,
      nested: { accessToken: secret, ordinary: `prefix ${secret} suffix` },
      authorization: 'Bearer visible-if-broken',
      url: 'https://api.example.test/path?key=visible-if-broken',
      note: 'https://api.example.test/also-hidden',
      payload: { harmlessLooking: secret },
      assignment: 'api_key=visible-if-broken',
      error,
      cyclic,
      datasetHash: 'a'.repeat(64),
      requestId: 'request-123',
      [secret]: 'ordinary value',
    });

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('visible-if-broken');
    expect(serialized).not.toContain('abc.def.ghi');
    expect(serialized).not.toContain('api.example.test');
    expect(serialized).not.toContain('stack');
    expect(entries[0]).toEqual(expect.objectContaining({
      timestamp: '2026-08-04T00:00:00.000Z',
      level: 'info',
      event: 'security.redaction_checked',
    }));
    expect(entries[0]?.context['apiKey']).toBe(REDACTED);
    expect(entries[0]?.context['datasetHash']).toBe('a'.repeat(64));
    expect(entries[0]?.context['requestId']).toBe('request-123');
  });

  it('supports inherited correlation context and severity filtering', () => {
    const entries: StructuredLogEntry[] = [];
    const logger = createStructuredLogger({
      sink: (entry) => entries.push(entry),
      minimumLevel: 'warn',
      context: { application: 'coqui' },
      timestamp: () => 'fixed',
    }).child({ component: 'research', correlationId: 'run-123' });

    logger.info('research.started');
    logger.warn('research.degraded', { reason: 'stale_data' });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.context).toEqual({
      application: 'coqui', component: 'research', correlationId: 'run-123',
      reason: 'stale_data',
    });
  });

  it('does not invoke accessors or let a broken sink affect application flow', () => {
    const getter = vi.fn(() => 'must-not-run');
    const hostile = Object.defineProperty({}, 'secret', { enumerable: true, get: getter });
    const logger = createStructuredLogger({ sink: () => { throw new Error('disk full'); } });

    expect(() => logger.error('logger.sink_failed', { hostile })).not.toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('contains failures from injected clocks', () => {
    const logger = createStructuredLogger({
      timestamp: () => { throw new Error('clock unavailable'); },
    });
    expect(() => logger.warn('logger.clock_failed')).not.toThrow();
  });

  it('rejects unstable event names before emitting them', () => {
    const sink = vi.fn();
    const logger = createStructuredLogger({ sink });
    expect(() => logger.info('Contains spaces')).toThrow(TypeError);
    expect(sink).not.toHaveBeenCalled();
  });
});
