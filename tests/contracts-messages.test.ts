import { describe, expect, it } from 'vitest';

import {
  commandEnvelopeSchema,
  componentStatusSchema,
  eventEnvelopeSchema,
} from '../packages/contracts/src/index.js';

const commandId = '00000000-0000-4000-8000-000000000001';
const eventId = '00000000-0000-4000-8000-000000000002';
const correlationId = '00000000-0000-4000-8000-000000000003';

const statusPayload = {
  componentId: 'scheduler',
  state: 'running',
  changedAtMs: 1_000,
  reasonCode: null,
} as const;

describe('message envelope contracts', () => {
  it('round-trips strict command and event envelopes', () => {
    const command = commandEnvelopeSchema(componentStatusSchema).parse({
      schemaVersion: 1,
      kind: 'command',
      type: 'component.start',
      commandId,
      correlationId,
      causationId: null,
      issuedAtMs: 2_000,
      payload: statusPayload,
    });
    const event = eventEnvelopeSchema(componentStatusSchema).parse({
      schemaVersion: 1,
      kind: 'event',
      type: 'component.state-changed',
      eventId,
      correlationId,
      causationId: commandId,
      occurredAtMs: 2_001,
      payload: statusPayload,
    });

    expect(command.payload).toEqual(statusPayload);
    expect(event.causationId).toBe(commandId);
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it.each([
    ['unknown fields', { extra: true }],
    ['malformed IDs', { commandId: 'not-a-uuid' }],
    ['non-dotted types', { type: 'start' }],
    ['unsafe timestamps', { issuedAtMs: Number.MAX_SAFE_INTEGER + 1 }],
    ['wrong discriminants', { kind: 'event' }],
    ['invalid payloads', { payload: { ...statusPayload, state: 'unknown' } }],
  ])('rejects %s', (_name, override) => {
    const result = commandEnvelopeSchema(componentStatusSchema).safeParse({
      schemaVersion: 1,
      kind: 'command',
      type: 'component.start',
      commandId,
      correlationId,
      causationId: null,
      issuedAtMs: 2_000,
      payload: statusPayload,
      ...override,
    });

    expect(result.success).toBe(false);
  });
});
