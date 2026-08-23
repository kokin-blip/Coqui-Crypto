import type { AlertRuleConfigView, AlertsService } from '@coqui/services';
import type { StoredAlertEvent } from '@coqui/storage';

/**
 * OS notifications, the one part of the alerts feature that never existed.
 *
 * `AlertsService` has had rules, cooldown, price targets and an append-only
 * event log since the transplant, and nothing anywhere constructed a
 * `Notification`. Alerts were recorded and could only be seen by opening the
 * app — which is the one situation in which a notification is pointless.
 *
 * This lives in the shell because `electron.Notification` is a shell API, and
 * because the decision of *whether* to notify has to be testable without an OS.
 * `selectNotifiable` is pure and takes the config; the delivery function is a
 * thin wrapper around it.
 */

export interface NotificationRequest {
  readonly title: string;
  readonly body: string;
  readonly silent: boolean;
}

export interface Notifier {
  isSupported(): boolean;
  show(request: NotificationRequest): void;
}

const KIND_TITLES: Readonly<Record<StoredAlertEvent['kind'], string>> = {
  allocation_drift: 'Allocation drift',
  regime_change: 'Regime change',
  big_move: 'Large price move',
  price_target: 'Price target reached',
  policy_event: 'Policy event',
  evidence_change: 'Evidence changed',
};

/**
 * Is `hourUtc` inside the quiet window?
 *
 * Handles a window that wraps midnight, which is the normal case: 22:00 to
 * 08:00 is not `start <= hour < end` and a naive comparison silently notifies
 * all night.
 */
export function inQuietHours(hourUtc: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  return startHour < endHour
    ? hourUtc >= startHour && hourUtc < endHour
    : hourUtc >= startHour || hourUtc < endHour;
}

export interface NotifiableSelection {
  readonly deliver: readonly StoredAlertEvent[];
  readonly silent: boolean;
  readonly suppressedByQuietHours: number;
}

/**
 * Decide what to show, given the config and the moment.
 *
 * Quiet hours suppress the *notification*, never the alert: the event is
 * already recorded and stays unread, so a suppressed alert is still waiting
 * when the user next looks. An alert nobody sees is worse than a late one, and
 * silently dropping the record would be the worse of the two failures.
 *
 * Only unread, unarchived events are considered. A notification for something
 * the user has already read is noise that teaches them to ignore the channel.
 */
export function selectNotifiable(
  events: readonly StoredAlertEvent[],
  config: AlertRuleConfigView,
  nowMs: number,
): NotifiableSelection {
  const unread = events.filter((event) => event.readAt === null && event.archivedAt === null);
  const quiet =
    config.quietHoursEnabled
    && inQuietHours(new Date(nowMs).getUTCHours(), config.quietStartHour, config.quietEndHour);

  return Object.freeze({
    deliver: quiet ? Object.freeze([]) : Object.freeze(unread),
    // Sound is a separate switch from delivery, so a user can keep the banners
    // and lose the noise.
    silent: !config.soundEnabled,
    suppressedByQuietHours: quiet ? unread.length : 0,
  });
}

/** Body text carrying the reason code, never a raw message (invariant 3). */
function describe(event: StoredAlertEvent): string {
  const instrument = event.productId === null ? '' : `${event.productId} · `;
  return `${instrument}${event.reasonCode.replaceAll('_', ' ')}`;
}

export interface AlertNotificationDependencies {
  readonly alerts: AlertsService;
  readonly notifier: Notifier;
  readonly profileId: string;
  readonly onUnexpectedError?: (context: string, error: unknown) => void;
}

export interface AlertNotificationPump {
  /** Deliver anything unread since the last call. Never throws. */
  deliver(nowMs: number): void;
}

/**
 * Deliver unread alerts, once each.
 *
 * The delivered set is tracked in memory rather than by marking events read.
 * Marking read is the *user's* action and clears the unread badge; doing it
 * here would make a notification the user never saw look like one they had
 * dismissed. A restart re-notifies at most once per still-unread alert, which
 * is the right way round.
 */
export function createAlertNotificationPump(
  dependencies: AlertNotificationDependencies,
): AlertNotificationPump {
  const notified = new Set<string>();
  const report = dependencies.onUnexpectedError ?? (() => {});

  return {
    deliver(nowMs) {
      try {
        if (!dependencies.notifier.isSupported()) return;
        const view = dependencies.alerts.view(dependencies.profileId);
        const selection = selectNotifiable(view.alerts, view.config, nowMs);

        for (const event of selection.deliver) {
          if (notified.has(event.id)) continue;
          notified.add(event.id);
          dependencies.notifier.show({
            title: KIND_TITLES[event.kind],
            body: describe(event),
            silent: selection.silent,
          });
        }
      } catch (error) {
        // A notification failure must never take down the tick that produced
        // the alert, nor the alert record itself.
        report('alert_notifications', error);
      }
    },
  };
}
