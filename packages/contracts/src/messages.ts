import * as z from 'zod';

export type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

export type ContractSchema = z.ZodType;
export type SchemaInput<TSchema extends ContractSchema> = z.input<TSchema>;

export const messageIdSchema = z.uuidv4();
export const epochMillisecondsSchema = z.number().int().nonnegative().safe();
export const jsonValueSchema = z.json();
export const messageTypeSchema = z.string().regex(
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/,
  'A message type must use dotted lowercase segments.',
);

export type JsonValue = z.infer<typeof jsonValueSchema>;

/** Build the strict wire schema for a command carrying the supplied payload schema. */
export function commandEnvelopeSchema<TPayloadSchema extends ContractSchema>(
  payloadSchema: TPayloadSchema,
) {
  return z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('command'),
    type: messageTypeSchema,
    commandId: messageIdSchema,
    correlationId: messageIdSchema,
    causationId: messageIdSchema.nullable(),
    issuedAtMs: epochMillisecondsSchema,
    payload: payloadSchema,
  }).readonly();
}

/** Build the strict wire schema for an event carrying the supplied payload schema. */
export function eventEnvelopeSchema<TPayloadSchema extends ContractSchema>(
  payloadSchema: TPayloadSchema,
) {
  return z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('event'),
    type: messageTypeSchema,
    eventId: messageIdSchema,
    correlationId: messageIdSchema,
    causationId: messageIdSchema.nullable(),
    occurredAtMs: epochMillisecondsSchema,
    payload: payloadSchema,
  }).readonly();
}

export type CommandEnvelope<TPayloadSchema extends ContractSchema> = DeepReadonly<
  z.infer<ReturnType<typeof commandEnvelopeSchema<TPayloadSchema>>>
>;

export type EventEnvelope<TPayloadSchema extends ContractSchema> = DeepReadonly<
  z.infer<ReturnType<typeof eventEnvelopeSchema<TPayloadSchema>>>
>;
