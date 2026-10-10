import { beginQueryTrace, finishQueryTrace } from './performance-trace.js';
import type {
  ChannelName,
  ChannelRequest,
  ChannelResponse,
  ComponentStateChangedPayload,
  CoquiClient,
  Outcome,
} from '@coqui/contracts';

declare global {
  interface Window {
    readonly coqui?: {
      readonly traceEnabled?: boolean;
      query(channel: string, payload: unknown, traceId?: string): Promise<Outcome<unknown>>;
      onComponentStateChanged(listener: (payload: unknown) => void): () => void;
    };
  }
}

/**
 * The renderer's single handle on the application.
 *
 * `window.coqui` is installed by the preload through `contextBridge`. If it is
 * missing the renderer is running outside Electron — a test, a stray browser
 * tab — and every call resolves to a transport failure rather than throwing,
 * so a screen degrades to its error state instead of a blank panel.
 */
export function createIpcClient(): CoquiClient {
  return {
    async query<TChannel extends ChannelName>(
      channel: TChannel,
      payload: ChannelRequest<TChannel>,
    ): Promise<Outcome<ChannelResponse<TChannel>>> {
      const bridge = window.coqui;
      if (bridge === undefined) {
        return {
          status: 'failed',
          issues: [{ path: ['transport'], code: 'transport_unavailable' }],
        };
      }
      const trace=beginQueryTrace(channel);
      const outcome=await bridge.query(channel,payload,trace?.id);
      if(trace)finishQueryTrace(channel,trace,new TextEncoder().encode(JSON.stringify(outcome)).byteLength);
      return outcome as Outcome<ChannelResponse<TChannel>>;
    },

    onComponentStateChanged(listener: (payload: ComponentStateChangedPayload) => void): () => void {
      const bridge = window.coqui;
      if (bridge === undefined) return () => {};
      return bridge.onComponentStateChanged((payload) => {
        listener(payload as ComponentStateChangedPayload);
      });
    },
  };
}
