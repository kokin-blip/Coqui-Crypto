import type { ChartVisibleRange } from './chart-workstation-types.js';

export type ChartLinkEvent =
  | { readonly kind: 'crosshair'; readonly sourceId: string; readonly timeMs: number | null }
  | { readonly kind: 'range'; readonly sourceId: string; readonly range: ChartVisibleRange | null };

type Listener = (event: ChartLinkEvent) => void;

/** Imperative link bus keeps high-frequency cursor movement outside React. */
export class ChartLinkController {
  readonly #listeners = new Map<string, Set<Listener>>();

  publish(group: string, event: ChartLinkEvent): void {
    for (const listener of this.#listeners.get(group) ?? []) listener(event);
  }

  subscribe(group: string, listener: Listener): () => void {
    const listeners = this.#listeners.get(group) ?? new Set<Listener>();
    listeners.add(listener);
    this.#listeners.set(group, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(group);
    };
  }
}
