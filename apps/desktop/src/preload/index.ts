import { contextBridge, ipcRenderer } from 'electron';

import {
  isChannelName,
  transportFailure,
  CHANNEL_SCHEMAS,
  COMPONENT_STATE_CHANGED,
  componentStateChangedPayloadSchema,
  type ChannelName,
  type Outcome,
} from '@coqui/contracts';

const QUERY_CHANNEL = 'coqui:query';

/**
 * The only object the renderer ever sees.
 *
 * Validation runs on both legs deliberately. Outbound, so a renderer bug or a
 * compromised renderer cannot hand `ipcMain` a channel or payload the contract
 * does not describe. Inbound, so a main-process reply that drifted from the
 * contract is caught at the boundary rather than rendering as a wrong number —
 * with `sandbox: true` and `contextIsolation: true` the renderer cannot verify
 * anything itself, so this is the last place a check is possible.
 *
 * Nothing here throws. A rejected promise crossing `contextBridge` reaches the
 * renderer as a plain string built from the error, which is both useless to a
 * surface and a leak risk, so every failure is a typed outcome instead.
 */
async function query(channel: unknown, payload: unknown): Promise<Outcome<unknown>> {
  if (!isChannelName(channel)) return transportFailure('unknown_channel');

  const schemas = CHANNEL_SCHEMAS[channel as ChannelName];
  const request = schemas.request.safeParse(payload);
  if (!request.success) return transportFailure('invalid_request_payload');

  let reply: unknown;
  try {
    reply = await ipcRenderer.invoke(QUERY_CHANNEL, channel, request.data);
  } catch {
    return transportFailure('transport_unavailable');
  }

  if (typeof reply !== 'object' || reply === null || !('status' in reply)) {
    return transportFailure('invalid_response_payload');
  }

  const outcome = reply as Outcome<unknown>;
  if (outcome.status !== 'ok') return outcome;

  const response = schemas.response.safeParse(outcome.value);
  if (!response.success) return transportFailure('invalid_response_payload');
  return { status: 'ok', value: response.data };
}

function onComponentStateChanged(listener: (payload: unknown) => void): () => void {
  const handler = (_event: unknown, raw: unknown): void => {
    const parsed = componentStateChangedPayloadSchema.safeParse(raw);
    if (parsed.success) listener(parsed.data);
  };
  ipcRenderer.on(COMPONENT_STATE_CHANGED, handler);
  return () => {
    ipcRenderer.removeListener(COMPONENT_STATE_CHANGED, handler);
  };
}

contextBridge.exposeInMainWorld('coqui', { query, onComponentStateChanged });
