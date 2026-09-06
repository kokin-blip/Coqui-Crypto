export type HostLifecycleState = 'stopped' | 'running';

export interface HostLifecycleStatus {
  readonly hostId: string;
  readonly state: HostLifecycleState;
  readonly recoveryCount: number;
  readonly tickCount: number;
}

export interface HostLifecycle {
  start(): void;
  recover(): void;
  tick(): Promise<void>;
  stop(): void;
  status(): HostLifecycleStatus;
}

export interface DesktopHostHooks {
  readonly hostId: string;
  readonly start: () => void;
  readonly recover: () => void;
  readonly tick: () => Promise<void>;
  readonly stop: () => void;
}

/** Transport-neutral lifecycle; Electron supplies hooks but is not imported here. */
export class DesktopHost implements HostLifecycle {
  readonly #hooks: DesktopHostHooks;
  #state: HostLifecycleState = 'stopped';
  #recoveryCount = 0;
  #tickCount = 0;

  constructor(hooks: DesktopHostHooks) {
    if (!hooks.hostId.trim()) throw new TypeError('A host identity is required.');
    this.#hooks = hooks;
  }

  start(): void {
    if (this.#state === 'running') return;
    this.recover();
    this.#hooks.start();
    this.#state = 'running';
  }

  recover(): void {
    this.#hooks.recover();
    this.#recoveryCount += 1;
  }

  async tick(): Promise<void> {
    if (this.#state !== 'running') throw new Error('Host is stopped.');
    await this.#hooks.tick();
    this.#tickCount += 1;
  }

  stop(): void {
    if (this.#state === 'stopped') return;
    this.#hooks.stop();
    this.#state = 'stopped';
  }

  status(): HostLifecycleStatus {
    return Object.freeze({
      hostId: this.#hooks.hostId, state: this.#state,
      recoveryCount: this.#recoveryCount, tickCount: this.#tickCount,
    });
  }
}
