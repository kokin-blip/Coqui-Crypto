import { describe, expect, it } from 'vitest';

import { DesktopHost } from '../packages/services/src/index.js';

describe('transport-neutral desktop host lifecycle', () => {
  it('recovers before start and supports deterministic start, tick, stop, and restart', async () => {
    const events: string[] = [];
    const host = new DesktopHost({
      hostId: 'desktop-a',
      recover: () => { events.push('recover'); },
      start: () => { events.push('start'); },
      tick: async () => { events.push('tick'); },
      stop: () => { events.push('stop'); },
    });
    expect(host.status()).toEqual({
      hostId: 'desktop-a', state: 'stopped', recoveryCount: 0, tickCount: 0,
    });
    await expect(host.tick()).rejects.toThrow('stopped');
    host.start();
    host.start();
    await host.tick();
    host.stop();
    host.stop();
    host.start();
    expect(events).toEqual(['recover', 'start', 'tick', 'stop', 'recover', 'start']);
    expect(host.status()).toEqual({
      hostId: 'desktop-a', state: 'running', recoveryCount: 2, tickCount: 1,
    });
    expect(Object.isFrozen(host.status())).toBe(true);
  });
});
