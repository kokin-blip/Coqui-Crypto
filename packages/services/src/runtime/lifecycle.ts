import {
  COMPONENT_STATE_CHANGED,
  componentStateChangedPayloadSchema,
  componentStatusSchema,
  type ComponentState,
  type ComponentStatus,
  type EventEnvelope,
  type LifecycleReasonCode,
} from '@coqui/contracts';

import {
  createEventEnvelope,
  type MessageRuntimeDependencies,
} from './messages.js';

const transitions = Object.freeze<Record<ComponentState, readonly ComponentState[]>>({
  ready: Object.freeze(['starting', 'disposing', 'faulted']),
  starting: Object.freeze(['running', 'stopping', 'faulted']),
  running: Object.freeze(['stopping', 'degraded', 'faulted']),
  stopping: Object.freeze(['stopped', 'faulted']),
  stopped: Object.freeze(['starting', 'disposing', 'faulted']),
  degraded: Object.freeze(['starting', 'stopping', 'faulted']),
  faulted: Object.freeze(['disposing']),
  disposing: Object.freeze(['disposed', 'faulted']),
  disposed: Object.freeze([]),
});

export interface LifecycleTransitionContext {
  readonly correlationId: string;
  readonly causationId?: string | null;
  readonly reasonCode?: LifecycleReasonCode | null;
}

export class LifecycleTransitionError extends Error {
  readonly currentState: ComponentState;
  readonly requestedState: ComponentState;

  constructor(currentState: ComponentState, requestedState: ComponentState) {
    super(`Invalid component lifecycle transition: ${currentState} -> ${requestedState}`);
    this.name = 'LifecycleTransitionError';
    this.currentState = currentState;
    this.requestedState = requestedState;
  }
}

/** Return whether a component lifecycle transition is explicitly permitted. */
export function canTransitionComponent(
  currentState: ComponentState,
  requestedState: ComponentState,
): boolean {
  return transitions[currentState].includes(requestedState);
}

/** Own one component's lifecycle state without owning its start or stop side effects. */
export class ComponentLifecycle {
  readonly #componentId: string;
  readonly #dependencies: MessageRuntimeDependencies;
  #status: ComponentStatus;

  constructor(componentId: string, dependencies: MessageRuntimeDependencies) {
    this.#componentId = componentId;
    this.#dependencies = dependencies;
    this.#status = componentStatusSchema.parse({
      componentId,
      state: 'ready',
      changedAtMs: dependencies.clock.nowMs(),
      reasonCode: null,
    }) as ComponentStatus;
  }

  get status(): ComponentStatus {
    return this.#status;
  }

  transition(
    requestedState: ComponentState,
    context: LifecycleTransitionContext,
  ): EventEnvelope<typeof componentStateChangedPayloadSchema> {
    const previousState = this.#status.state;
    if (!canTransitionComponent(previousState, requestedState)) {
      throw new LifecycleTransitionError(previousState, requestedState);
    }

    const reasonCode = context.reasonCode ?? null;
    const event = createEventEnvelope(
      componentStateChangedPayloadSchema,
      {
        type: COMPONENT_STATE_CHANGED,
        correlationId: context.correlationId,
        causationId: context.causationId ?? null,
        payload: {
          componentId: this.#componentId,
          previousState,
          state: requestedState,
          reasonCode,
        },
      },
      this.#dependencies,
    );
    const nextStatus = componentStatusSchema.parse({
      componentId: this.#componentId,
      state: requestedState,
      changedAtMs: event.occurredAtMs,
      reasonCode,
    }) as ComponentStatus;

    this.#status = nextStatus;
    return event;
  }
}
