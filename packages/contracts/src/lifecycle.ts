import * as z from 'zod';

import { epochMillisecondsSchema, type DeepReadonly } from './messages.js';

export const COMPONENT_STATE_CHANGED = 'component.state-changed' as const;

export const componentStateSchema = z.enum([
  'ready',
  'starting',
  'running',
  'stopping',
  'stopped',
  'degraded',
  'faulted',
  'disposing',
  'disposed',
]);

export const lifecycleReasonCodeSchema = z.string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'A lifecycle reason must be a stable lowercase code.');

export const componentStatusSchema = z.strictObject({
  componentId: z.string().trim().min(1).max(128),
  state: componentStateSchema,
  changedAtMs: epochMillisecondsSchema,
  reasonCode: lifecycleReasonCodeSchema.nullable(),
}).readonly();

export const componentStateChangedPayloadSchema = z.strictObject({
  componentId: z.string().trim().min(1).max(128),
  previousState: componentStateSchema,
  state: componentStateSchema,
  reasonCode: lifecycleReasonCodeSchema.nullable(),
}).readonly();

export type ComponentState = z.infer<typeof componentStateSchema>;
export type LifecycleReasonCode = z.infer<typeof lifecycleReasonCodeSchema>;
export type ComponentStatus = DeepReadonly<z.infer<typeof componentStatusSchema>>;
export type ComponentStateChangedPayload = DeepReadonly<
  z.infer<typeof componentStateChangedPayloadSchema>
>;
