import type { ChannelName, ChannelRequest, ChannelResponse } from './channels.js';
import type { ComponentStateChangedPayload } from './lifecycle.js';
import type { Outcome } from './rpc.js';

export interface QueryOptions {
  /** Abandons the wait. The main process is told, so work can stop early. */
  readonly signal?: AbortSignal;
}

/**
 * The renderer's only door to the application.
 *
 * `CLAUDE.md` §4 permits no component to import services, storage, or adapters,
 * and no component to call IPC directly. Everything reaches this interface
 * instead. It is deliberately transport-neutral: the Electron IPC transport is
 * one implementation, and `ARCHITECTURE.md` §7 keeps the option of another
 * shell open without rewriting a single screen.
 *
 * `query` never rejects. A thrown exception at a UI boundary tends to become an
 * unhandled rejection or a blank panel, so transport failures arrive as a
 * `failed` outcome carrying a stable code, exactly like a service-level issue.
 * The four-way `Outcome` is what makes the action-feedback contract in
 * `docs/UI-UX.md` §3.1 expressible at all.
 */
export interface CoquiClient {
  query<TChannel extends ChannelName>(
    channel: TChannel,
    payload: ChannelRequest<TChannel>,
    options?: QueryOptions,
  ): Promise<Outcome<ChannelResponse<TChannel>>>;

  /**
   * Component lifecycle transitions pushed from the main process.
   *
   * Returns its own unsubscribe function. The query layer owns the single
   * subscription; components never register their own, for the same reason
   * they never own a `setInterval`.
   */
  onComponentStateChanged(listener: (payload: ComponentStateChangedPayload) => void): () => void;
}
