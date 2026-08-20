import { describe, expect, it } from 'vitest';

import {
  COMPONENT_STATE_CHANGED,
  componentStateChangedPayloadSchema,
  jsonValueSchema,
  type ComponentState,
  type LifecycleReasonCode,
} from '../packages/contracts/src/index.js';
import { FixedClock } from '../packages/core/src/index.js';
import {
  ComponentLifecycle,
  LifecycleTransitionError,
  canTransitionComponent,
  createCommandEnvelope,
  createEventEnvelope,
  type MessageIdSource,
} from '../packages/services/src/index.js';

const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
] as const;

class SequenceIdSource implements MessageIdSource {
  #index = 0;

  nextId(): string {
    const id = ids[this.#index];
    if (!id) throw new RangeError('The test ID sequence is exhausted.');
    this.#index += 1;
    return id;
  }
}

function dependencies(clock = new FixedClock(1_000)) {
  return { clock, idSource: new SequenceIdSource() };
}

describe('message runtime', () => {
  it('uses injected IDs and time and roots correlation at the command', () => {
    const clock = new FixedClock(10_000);
    const runtime = dependencies(clock);
    const command = createCommandEnvelope(
      jsonValueSchema,
      { type: 'scheduler.run', payload: { wallet: 'alpha' } },
      runtime,
    );
    clock.advanceBy(25);
    const event = createEventEnvelope(
      jsonValueSchema,
      {
        type: 'scheduler.run-completed',
        correlationId: command.correlationId,
        causationId: command.commandId,
        payload: { count: 1 },
      },
      runtime,
    );

    expect(command).toMatchObject({
      commandId: ids[0],
      correlationId: ids[0],
      causationId: null,
      issuedAtMs: 10_000,
    });
    expect(event).toMatchObject({
      eventId: ids[1],
      correlationId: ids[0],
      causationId: ids[0],
      occurredAtMs: 10_025,
    });
  });

  it('detaches and deeply freezes nested payloads', () => {
    const payload = { wallet: { name: 'alpha' }, jobs: ['market-data'] };
    const command = createCommandEnvelope(
      jsonValueSchema,
      { type: 'scheduler.run', payload },
      dependencies(),
    );
    payload.wallet.name = 'changed';
    payload.jobs.push('research');

    expect(command.payload).toEqual({ wallet: { name: 'alpha' }, jobs: ['market-data'] });
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.payload)).toBe(true);
    expect(Object.isFrozen((command.payload as { wallet: object }).wallet)).toBe(true);
    expect(() => {
      (command.payload as { wallet: { name: string } }).wallet.name = 'mutated';
    }).toThrow(TypeError);
  });

  it('rejects non-JSON payload values', () => {
    expect(() => createCommandEnvelope(
      jsonValueSchema,
      { type: 'scheduler.run', payload: { value: undefined } as never },
      dependencies(),
    )).toThrow();
  });
});

const states: readonly ComponentState[] = [
  'ready',
  'starting',
  'running',
  'stopping',
  'stopped',
  'degraded',
  'faulted',
  'disposing',
  'disposed',
];

const allowed: Readonly<Record<ComponentState, readonly ComponentState[]>> = {
  ready: ['starting', 'disposing', 'faulted'],
  starting: ['running', 'stopping', 'faulted'],
  running: ['stopping', 'degraded', 'faulted'],
  stopping: ['stopped', 'faulted'],
  stopped: ['starting', 'disposing', 'faulted'],
  degraded: ['starting', 'stopping', 'faulted'],
  faulted: ['disposing'],
  disposing: ['disposed', 'faulted'],
  disposed: [],
};

describe('component lifecycle', () => {
  it('exposes exactly the frozen legal transition table', () => {
    for (const from of states) {
      for (const to of states) {
        expect(canTransitionComponent(from, to)).toBe(allowed[from].includes(to));
      }
    }
  });

  it('starts ready and emits a correlated immutable state-change event', () => {
    const clock = new FixedClock(5_000);
    const lifecycle = new ComponentLifecycle('scheduler', dependencies(clock));
    clock.advanceBy(100);
    const event = lifecycle.transition('starting', {
      correlationId: ids[3],
      causationId: ids[4],
      reasonCode: 'start_requested',
    });

    expect(event.type).toBe(COMPONENT_STATE_CHANGED);
    expect(event).toMatchObject({
      eventId: ids[0],
      correlationId: ids[3],
      causationId: ids[4],
      occurredAtMs: 5_100,
      payload: {
        componentId: 'scheduler',
        previousState: 'ready',
        state: 'starting',
        reasonCode: 'start_requested',
      },
    });
    expect(lifecycle.status).toEqual({
      componentId: 'scheduler',
      state: 'starting',
      changedAtMs: 5_100,
      reasonCode: 'start_requested',
    });
    expect(Object.isFrozen(event.payload)).toBe(true);
  });

  it('keeps state unchanged after illegal transitions or invalid reason codes', () => {
    const lifecycle = new ComponentLifecycle('scheduler', dependencies());

    expect(() => lifecycle.transition('running', { correlationId: ids[3] }))
      .toThrow(LifecycleTransitionError);
    expect(lifecycle.status.state).toBe('ready');
    expect(() => lifecycle.transition('starting', {
      correlationId: ids[3],
      reasonCode: 'API key leaked' as LifecycleReasonCode,
    })).toThrow();
    expect(lifecycle.status.state).toBe('ready');
  });

  it('makes disposed terminal', () => {
    const lifecycle = new ComponentLifecycle('scheduler', dependencies());
    lifecycle.transition('disposing', { correlationId: ids[3] });
    lifecycle.transition('disposed', { correlationId: ids[3] });

    for (const state of states) {
      expect(() => lifecycle.transition(state, { correlationId: ids[3] }))
        .toThrow(LifecycleTransitionError);
    }
  });

  it('has no wire field for raw errors or free-form messages', () => {
    expect(componentStateChangedPayloadSchema.safeParse({
      componentId: 'scheduler',
      previousState: 'ready',
      state: 'faulted',
      reasonCode: 'start_failed',
      error: new Error('secret canary'),
    }).success).toBe(false);
  });
});
