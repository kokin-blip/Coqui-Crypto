/**
 * The action-feedback contract from `docs/UI-UX.md` §3.1, as a state machine.
 *
 * It lives here rather than inside a button component because the rule it
 * enforces is not visual: **optimistic success is forbidden** for financial,
 * credential, kill-switch, export and destructive actions. A component that
 * flips to "done" on click satisfies every visual review and still violates the
 * contract, so the transition is the thing that has to be tested.
 */

export type ActionSensitivity = 'ordinary' | 'consequential';

export type ActionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'succeeded' }
  | { readonly kind: 'failed'; readonly codes: readonly string[] }
  | { readonly kind: 'blocked'; readonly codes: readonly string[] }
  /** Invariant 15 on screen: never presented as success or failure. */
  | { readonly kind: 'unknown'; readonly codes: readonly string[] };

export type ActionEvent =
  | { readonly type: 'activate' }
  | { readonly type: 'settled'; readonly status: 'ok' | 'failed' | 'blocked' | 'unknown'; readonly codes?: readonly string[] }
  | { readonly type: 'reset' };

/**
 * Labels do not change width between idle and pending.
 *
 * §3.1 requires a stable pending label with no layout shift. "Submit" becoming
 * "Submitting…" reflows the row and moves whatever sits beside it, which under
 * a mispress can move the next control under the cursor.
 */
export interface ActionLabels {
  readonly idle: string;
  readonly pending: string;
}

export function isTerminal(state: ActionState): boolean {
  return state.kind !== 'idle' && state.kind !== 'pending';
}

/**
 * Reduce one event.
 *
 * Two properties matter. A second `activate` while pending is ignored, which is
 * the duplicate-command prevention §3.1 requires — for a non-idempotent channel
 * a double submit is a second order. And `settled` is the *only* path to
 * `succeeded`, so no caller can shortcut to it on click.
 */
export function reduceAction(state: ActionState, event: ActionEvent): ActionState {
  switch (event.type) {
    case 'activate':
      // Ignored while pending: the command is already in flight.
      return state.kind === 'pending' ? state : { kind: 'pending' };

    case 'settled': {
      if (state.kind !== 'pending') return state;
      const codes = event.codes ?? [];
      switch (event.status) {
        case 'ok':
          return { kind: 'succeeded' };
        case 'blocked':
          return { kind: 'blocked', codes };
        case 'unknown':
          return { kind: 'unknown', codes };
        default:
          return { kind: 'failed', codes };
      }
    }

    default:
      return { kind: 'idle' };
  }
}

export interface ActionPresentation {
  readonly label: string;
  readonly disabled: boolean;
  readonly busy: boolean;
  /** Announcement for assistive technology; empty while idle. */
  readonly liveMessage: string;
  /** Whether a fresh confirmation is required before another attempt. */
  readonly requiresReconfirmation: boolean;
}

export function presentAction(
  state: ActionState,
  labels: ActionLabels,
  sensitivity: ActionSensitivity = 'ordinary',
): ActionPresentation {
  switch (state.kind) {
    case 'pending':
      return {
        label: labels.pending,
        disabled: true,
        busy: true,
        liveMessage: `${labels.pending}. Waiting for confirmation.`,
        requiresReconfirmation: false,
      };
    case 'succeeded':
      return {
        label: labels.idle,
        disabled: false,
        busy: false,
        liveMessage: 'Confirmed.',
        requiresReconfirmation: false,
      };
    case 'blocked':
      return {
        label: labels.idle,
        // A guardrail refused. Re-pressing without changing anything would be
        // refused identically, so the control stays disabled until reset.
        disabled: true,
        busy: false,
        liveMessage: `Blocked: ${state.codes.join(', ')}`,
        requiresReconfirmation: true,
      };
    case 'unknown':
      return {
        label: labels.idle,
        // Invariant 15: recovery queries the venue. Offering a retry button
        // here is how a blind resubmit happens.
        disabled: true,
        busy: false,
        liveMessage: `Outcome unconfirmed: ${state.codes.join(', ')}. Do not retry.`,
        requiresReconfirmation: true,
      };
    case 'failed':
      return {
        label: labels.idle,
        disabled: false,
        busy: false,
        liveMessage: `Failed: ${state.codes.join(', ')}`,
        // A consequential action re-confirms rather than re-firing from a
        // one-click retry.
        requiresReconfirmation: sensitivity === 'consequential',
      };
    default:
      return {
        label: labels.idle,
        disabled: false,
        busy: false,
        liveMessage: '',
        requiresReconfirmation: false,
      };
  }
}
