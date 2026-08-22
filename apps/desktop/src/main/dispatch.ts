import {
  isChannelName,
  transportFailure,
  CHANNEL_SCHEMAS,
  type ChannelName,
  type ContractIssue,
  type Outcome,
} from '@coqui/contracts';

/**
 * What a service hands back: the `{ ok, value } | { ok, issues }` shape every
 * Coqui service already returns, or a bare value for a call that cannot fail.
 */
export type ServiceResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly issues: readonly ContractIssue[] };

export type ChannelHandler = (payload: never) => Promise<ServiceResult<unknown>> | ServiceResult<unknown>;

export type ChannelHandlers = Readonly<Record<ChannelName, ChannelHandler>>;

/**
 * Issue codes that mean "a guardrail said no", not "something broke".
 *
 * `docs/UI-UX.md` §3.1 requires a surface to distinguish these, and the
 * distinction has to be made here because only the boundary sees both the
 * service's issue codes and the wire's four-way outcome.
 */
const BLOCKED_CODES: ReadonlySet<string> = new Set([
  'kill_switch_engaged',
  'guardrail_rejected',
  'execution_not_permitted',
  'permission_denied',
  'gate_not_met',
  // Invariant 12 declining to record a match against a lot that does not
  // exist. Nothing broke — a rule refused, and the surface must say so rather
  // than showing an error the user would read as a bug.
  'unknown_lot',
]);

/** Codes describing an outcome the application genuinely cannot determine. */
const UNKNOWN_CODES: ReadonlySet<string> = new Set([
  'source_cancelled',
  'source_shutdown',
  'recovery_required',
  'ambiguous_outcome',
]);

function classify<TValue>(issues: readonly ContractIssue[]): Outcome<TValue> {
  if (issues.some((issue) => BLOCKED_CODES.has(issue.code))) {
    return { status: 'blocked', issues };
  }
  if (issues.some((issue) => UNKNOWN_CODES.has(issue.code))) {
    return { status: 'unknown', issues };
  }
  return { status: 'failed', issues };
}

export interface DispatcherOptions {
  readonly handlers: ChannelHandlers;
  /**
   * Called with a thrown error so it reaches the log with full detail. The
   * dispatcher itself never puts a message on the wire.
   */
  readonly onUnexpectedError?: (channel: ChannelName, error: unknown) => void;
}

/**
 * The single entry point from `ipcMain` into the application.
 *
 * Four properties matter here, and none of them can be delegated to a service.
 *
 * A channel absent from the registry is refused rather than forwarded, so
 * adding an `ipcMain.handle` elsewhere cannot widen the surface. Request
 * payloads are validated against the contract before a service sees them, so
 * every service can trust its input. Responses are validated on the way out,
 * because a service that drifts from the contract should fail here rather than
 * produce a screen that renders wrong. And nothing throws: an unexpected error
 * becomes a stable `failed` outcome, since an exception crossing IPC would
 * arrive at the renderer as a string built from the error's own message —
 * exactly the leak invariant 3 forbids.
 */
export function createDispatcher(options: DispatcherOptions) {
  const { handlers, onUnexpectedError } = options;

  return async function dispatch(channel: unknown, payload: unknown): Promise<Outcome<unknown>> {
    if (!isChannelName(channel)) return transportFailure('unknown_channel');

    const schemas = CHANNEL_SCHEMAS[channel];
    const request = schemas.request.safeParse(payload);
    if (!request.success) return transportFailure('invalid_request_payload');

    // The whole body stays inside the guard. Reading `.ok` on a handler that
    // returned nothing would otherwise throw past it, and a dispatcher that
    // can throw defeats the point of having one.
    try {
      const handler = handlers[channel];
      const result: ServiceResult<unknown> = await handler(request.data as never);

      if (typeof result !== 'object' || result === null || typeof result.ok !== 'boolean') {
        onUnexpectedError?.(channel, new TypeError(`Handler for ${channel} returned a non-result.`));
        return transportFailure('transport_unavailable');
      }

      if (!result.ok) return classify(result.issues);

      const response = schemas.response.safeParse(result.value);
      if (!response.success) {
        onUnexpectedError?.(channel, response.error);
        return transportFailure('invalid_response_payload');
      }

      return { status: 'ok', value: response.data };
    } catch (error) {
      onUnexpectedError?.(channel, error);
      return transportFailure('transport_unavailable');
    }
  };
}
