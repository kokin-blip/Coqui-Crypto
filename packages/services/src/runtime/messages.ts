import {
  commandEnvelopeSchema,
  eventEnvelopeSchema,
  type CommandEnvelope,
  type ContractSchema,
  type EventEnvelope,
  type SchemaInput,
} from '@coqui/contracts';
import type { Clock } from '@coqui/core';

export interface MessageIdSource {
  nextId(): string;
}

export interface MessageRuntimeDependencies {
  readonly clock: Clock;
  readonly idSource: MessageIdSource;
}

export interface CommandEnvelopeInput<TPayload> {
  readonly type: string;
  readonly payload: TPayload;
  readonly correlationId?: string;
  readonly causationId?: string | null;
}

export interface EventEnvelopeInput<TPayload> {
  readonly type: string;
  readonly payload: TPayload;
  readonly correlationId: string;
  readonly causationId?: string | null;
}

function cloneJsonValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Message payload numbers must be finite.');
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('Message payloads must contain only JSON-compatible values.');
  }
  if (seen.has(value)) throw new TypeError('Message payloads cannot contain cycles.');
  seen.add(value);

  if (Array.isArray(value)) {
    const cloned = value.map((item) => cloneJsonValue(item, seen));
    seen.delete(value);
    return Object.freeze(cloned);
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Message payload objects must use the ordinary object prototype.');
  }

  const cloned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    cloned[key] = cloneJsonValue(item, seen);
  }
  seen.delete(value);
  return Object.freeze(cloned);
}

function detachAndFreeze<TValue>(value: TValue): TValue {
  return cloneJsonValue(value, new WeakSet()) as TValue;
}

/** Create an immutable, schema-validated command using only injected time and IDs. */
export function createCommandEnvelope<TPayloadSchema extends ContractSchema>(
  payloadSchema: TPayloadSchema,
  input: CommandEnvelopeInput<SchemaInput<TPayloadSchema>>,
  dependencies: MessageRuntimeDependencies,
): CommandEnvelope<TPayloadSchema> {
  const commandId = dependencies.idSource.nextId();
  const parsed = commandEnvelopeSchema(payloadSchema).parse({
    schemaVersion: 1,
    kind: 'command',
    type: input.type,
    commandId,
    correlationId: input.correlationId ?? commandId,
    causationId: input.causationId ?? null,
    issuedAtMs: dependencies.clock.nowMs(),
    payload: input.payload,
  });
  return detachAndFreeze(parsed) as CommandEnvelope<TPayloadSchema>;
}

/** Create an immutable, schema-validated event using only injected time and IDs. */
export function createEventEnvelope<TPayloadSchema extends ContractSchema>(
  payloadSchema: TPayloadSchema,
  input: EventEnvelopeInput<SchemaInput<TPayloadSchema>>,
  dependencies: MessageRuntimeDependencies,
): EventEnvelope<TPayloadSchema> {
  const parsed = eventEnvelopeSchema(payloadSchema).parse({
    schemaVersion: 1,
    kind: 'event',
    type: input.type,
    eventId: dependencies.idSource.nextId(),
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    occurredAtMs: dependencies.clock.nowMs(),
    payload: input.payload,
  });
  return detachAndFreeze(parsed) as EventEnvelope<TPayloadSchema>;
}
