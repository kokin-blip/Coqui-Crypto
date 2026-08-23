import { describe, expect, it } from 'vitest';

import {
  createAlertNotificationPump,
  inQuietHours,
  selectNotifiable,
  type NotificationRequest,
  type Notifier,
} from '../apps/desktop/src/main/notifications.js';
import { FixedClock } from '../packages/core/src/index.js';
import { AlertsService, type AlertRuleConfigView } from '../packages/services/src/index.js';
import { openDatabase, type StoredAlertEvent } from '../packages/storage/src/index.js';

const T0 = Date.UTC(2026, 0, 1, 12);
const PROFILE = 'main';

const CONFIG: AlertRuleConfigView = {
  driftEnabled: true,
  regimeEnabled: true,
  bigMoveEnabled: true,
  bigMovePct: '10',
  priceTargetEnabled: true,
  soundEnabled: true,
  quietHoursEnabled: false,
  quietStartHour: 22,
  quietEndHour: 8,
  source: 'default',
  updatedAtMs: null,
};

function event(overrides: Partial<StoredAlertEvent> = {}): StoredAlertEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    profileId: PROFILE,
    eventKey: 'big_move:btc-usd:2026-01-01',
    kind: 'big_move',
    severity: 'warn',
    reasonCode: 'daily_move_exceeded',
    evidenceHash: 'a'.repeat(64),
    venue: 'coinbase',
    productId: 'BTC-USD',
    productType: 'spot',
    occurredAt: T0 - 1_000,
    recordedAt: T0,
    readAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function recordingNotifier(supported = true): Notifier & { readonly shown: NotificationRequest[] } {
  const shown: NotificationRequest[] = [];
  return {
    shown,
    isSupported: () => supported,
    show: (request) => shown.push(request),
  };
}

describe('a quiet window that wraps midnight is still a window', () => {
  it('covers the hours either side of midnight', () => {
    // 22:00–08:00 is not `start <= hour < end`, and the naive comparison
    // notifies all night — which is the failure this exists to prevent.
    expect(inQuietHours(23, 22, 8)).toBe(true);
    expect(inQuietHours(3, 22, 8)).toBe(true);
    expect(inQuietHours(12, 22, 8)).toBe(false);
    expect(inQuietHours(8, 22, 8)).toBe(false);
  });

  it('handles a same-day window', () => {
    expect(inQuietHours(10, 9, 17)).toBe(true);
    expect(inQuietHours(18, 9, 17)).toBe(false);
  });

  it('treats an empty window as no quiet hours', () => {
    expect(inQuietHours(5, 8, 8)).toBe(false);
  });
});

describe('quiet hours suppress the notification, never the alert', () => {
  it('delivers nothing during the quiet window', () => {
    const quiet = { ...CONFIG, quietHoursEnabled: true, quietStartHour: 11, quietEndHour: 13 };
    const selection = selectNotifiable([event()], quiet, T0);

    expect(selection.deliver).toHaveLength(0);
    // The count is reported rather than swallowed: an alert nobody sees is
    // worse than a late one, and the record is still unread and waiting.
    expect(selection.suppressedByQuietHours).toBe(1);
  });

  it('delivers outside the window', () => {
    const quiet = { ...CONFIG, quietHoursEnabled: true, quietStartHour: 22, quietEndHour: 8 };
    expect(selectNotifiable([event()], quiet, T0).deliver).toHaveLength(1);
  });

  it('keeps sound as a separate switch from delivery', () => {
    // A user can keep the banners and lose the noise.
    expect(selectNotifiable([event()], { ...CONFIG, soundEnabled: false }, T0).silent).toBe(true);
    expect(selectNotifiable([event()], CONFIG, T0).silent).toBe(false);
  });
});

describe('only unread, unarchived alerts are announced', () => {
  it('skips one the user has already read', () => {
    // Re-announcing something already seen is noise that teaches the user to
    // ignore the channel.
    expect(selectNotifiable([event({ readAt: T0 })], CONFIG, T0).deliver).toHaveLength(0);
  });

  it('skips an archived one', () => {
    expect(selectNotifiable([event({ archivedAt: T0 })], CONFIG, T0).deliver).toHaveLength(0);
  });
});

describe('the pump delivers each alert once', () => {
  function pumped(notifier: Notifier) {
    const database = openDatabase(':memory:');
    const alerts = new AlertsService({
      database,
      clock: new FixedClock(T0),
      idSource: { nextId: () => '22222222-2222-4222-8222-222222222222' },
    });
    alerts.record(PROFILE, {
      eventKey: 'big_move:btc-usd:2026-01-01',
      kind: 'big_move',
      severity: 'warn',
      reasonCode: 'daily_move_exceeded',
      evidenceHash: 'a'.repeat(64),
      instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
      occurredAtMs: T0 - 1_000,
    });
    return {
      database,
      pump: createAlertNotificationPump({ alerts, notifier, profileId: PROFILE }),
    };
  }

  it('shows a recorded alert', () => {
    const notifier = recordingNotifier();
    const { database, pump } = pumped(notifier);

    pump.deliver(T0);
    expect(notifier.shown).toHaveLength(1);
    expect(notifier.shown[0]?.title).toBe('Large price move');
    expect(notifier.shown[0]?.body).toContain('BTC-USD');
    database.close();
  });

  it('does not repeat it on the next tick', () => {
    const notifier = recordingNotifier();
    const { database, pump } = pumped(notifier);

    pump.deliver(T0);
    pump.deliver(T0 + 60_000);

    // Tracked in memory rather than by marking the alert read: marking read is
    // the *user's* action, and doing it here would make a notification they
    // never saw look like one they dismissed.
    expect(notifier.shown).toHaveLength(1);
    database.close();
  });

  it('does nothing where the OS has no notifications', () => {
    const notifier = recordingNotifier(false);
    const { database, pump } = pumped(notifier);

    pump.deliver(T0);
    expect(notifier.shown).toHaveLength(0);
    database.close();
  });

  it('reports a notifier failure instead of throwing into the tick', () => {
    const failures: string[] = [];
    const database = openDatabase(':memory:');
    const alerts = new AlertsService({
      database,
      clock: new FixedClock(T0),
      idSource: { nextId: () => '33333333-3333-4333-8333-333333333333' },
    });
    const pump = createAlertNotificationPump({
      alerts,
      profileId: PROFILE,
      notifier: {
        isSupported: () => true,
        show: () => {
          throw new Error('notification centre unavailable');
        },
      },
      onUnexpectedError: (context) => failures.push(context),
    });
    alerts.record(PROFILE, {
      eventKey: 'big_move:btc-usd:2026-01-02',
      kind: 'big_move',
      severity: 'warn',
      reasonCode: 'daily_move_exceeded',
      evidenceHash: 'b'.repeat(64),
      instrument: null,
      occurredAtMs: T0 - 1_000,
    });

    // A notification failure must never take down the tick that produced the
    // alert, nor the alert record itself.
    expect(() => pump.deliver(T0)).not.toThrow();
    expect(failures).toContain('alert_notifications');
    database.close();
  });
});
