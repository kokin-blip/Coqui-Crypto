import * as z from 'zod';

import {
  epochMillisecondsSchema,
  messageIdSchema,
  messageTypeSchema,
  type ContractSchema,
  type DeepReadonly,
} from './messages.js';

/**
 * Stable issue shape shared by every response.
 *
 * `code` is deliberately a constrained lowercase token rather than free text.
 * Services already return typed issue codes; the wire keeps that property so a
 * provider message, a stack, or a file path can never reach the renderer
 * through an error channel (invariant 3).
 */
export const issueCodeSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'An issue code must be a stable lowercase token.');

export const issueSchema = z
  .strictObject({
    path: z.array(z.string().min(1).max(64)).max(8).readonly(),
    code: issueCodeSchema,
  })
  .readonly();

export type ContractIssue = DeepReadonly<z.infer<typeof issueSchema>>;

/**
 * The four outcomes a surface must be able to render distinctly.
 *
 * `docs/UI-UX.md` §3.1 requires explicit success, failure, blocked, and unknown
 * states, and forbids optimistic success on financial, credential, kill-switch,
 * export, and destructive actions. Encoding all four in the envelope means a
 * component cannot accidentally collapse them into a boolean.
 *
 * `blocked` is not a failure: a guardrail refused, the system is healthy, and
 * the user needs to know which rule stopped them. `unknown` carries invariant
 * 15 onto the wire — an ambiguous outcome is never reported as either success
 * or failure, and never silently retried.
 */
export const outcomeStatusSchema = z.enum(['ok', 'failed', 'blocked', 'unknown']);
export type OutcomeStatus = z.infer<typeof outcomeStatusSchema>;

export function requestEnvelopeSchema<TPayloadSchema extends ContractSchema>(
  payloadSchema: TPayloadSchema,
) {
  return z
    .strictObject({
      schemaVersion: z.literal(1),
      kind: z.literal('request'),
      type: messageTypeSchema,
      requestId: messageIdSchema,
      correlationId: messageIdSchema,
      issuedAtMs: epochMillisecondsSchema,
      payload: payloadSchema,
    })
    .readonly();
}

export function responseEnvelopeSchema<TValueSchema extends ContractSchema>(
  valueSchema: TValueSchema,
) {
  return z
    .strictObject({
      schemaVersion: z.literal(1),
      kind: z.literal('response'),
      type: messageTypeSchema,
      requestId: messageIdSchema,
      correlationId: messageIdSchema,
      respondedAtMs: epochMillisecondsSchema,
      // Members stay mutable objects so Zod can discriminate on `status`; the
      // envelope's own `.readonly()` and `DeepReadonly` freeze the result type.
      result: z.discriminatedUnion('status', [
        z.strictObject({ status: z.literal('ok'), value: valueSchema }),
        z.strictObject({
          status: z.literal('failed'),
          issues: z.array(issueSchema).min(1).max(32).readonly(),
        }),
        z.strictObject({
          status: z.literal('blocked'),
          issues: z.array(issueSchema).min(1).max(32).readonly(),
        }),
        z.strictObject({
          status: z.literal('unknown'),
          issues: z.array(issueSchema).min(1).max(32).readonly(),
        }),
      ]),
    })
    .readonly();
}

export type RequestEnvelope<TPayloadSchema extends ContractSchema> = DeepReadonly<
  z.infer<ReturnType<typeof requestEnvelopeSchema<TPayloadSchema>>>
>;

export type ResponseEnvelope<TValueSchema extends ContractSchema> = DeepReadonly<
  z.infer<ReturnType<typeof responseEnvelopeSchema<TValueSchema>>>
>;

/** The result half of a response, as a caller consumes it. */
export type Outcome<TValue> =
  | { readonly status: 'ok'; readonly value: TValue }
  | { readonly status: 'failed'; readonly issues: readonly ContractIssue[] }
  | { readonly status: 'blocked'; readonly issues: readonly ContractIssue[] }
  | { readonly status: 'unknown'; readonly issues: readonly ContractIssue[] };

/**
 * Transport-level issues, raised by the boundary rather than by a service.
 *
 * These are the failures that exist because there *is* a boundary: the channel
 * is not registered, the payload did not validate, the main process replied
 * with something that is not a valid response, or the call was abandoned. They
 * share the issue vocabulary so a surface handles them the same way.
 */
export const TRANSPORT_ISSUE_CODES = [
  'unknown_channel',
  'invalid_request_payload',
  'invalid_response_payload',
  'transport_unavailable',
  'request_cancelled',
] as const;

export type TransportIssueCode = (typeof TRANSPORT_ISSUE_CODES)[number];

export function transportFailure<TValue>(code: TransportIssueCode): Outcome<TValue> {
  return { status: 'failed', issues: [{ path: ['transport'], code }] };
}
