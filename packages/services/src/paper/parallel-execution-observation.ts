import { instrumentKey } from '@coqui/core';
import type { createAlpacaPaperClient } from '@coqui/adapters';
import type { ParallelPaperEvent } from '@coqui/storage';

import { parallelQuotes } from './parallel-paper-intraday.js';
import { parallelPaperFailureDetail, symbolFor } from './parallel-paper-utils.js';
import { PARALLEL_INSTRUMENTS } from './parallel-signal.js';

/** Preserve the existing five-slot tape for its separately registered study. */
export async function recordFourHourExecutionObservation(input: {
  readonly now: () => number; readonly day: string; readonly datasetHash: string;
  readonly weights: Record<string, number>; readonly events: () => readonly ParallelPaperEvent[];
  readonly client: Pick<ReturnType<typeof createAlpacaPaperClient>, 'latestCryptoQuotes'>;
  readonly append: (kind: string, key: string, detail: Record<string, unknown>) => void;
}): Promise<void> {
  const observedAt = input.now();
  const slot = new Date(observedAt).toISOString().slice(0, 13);
  if (new Date(observedAt).getUTCHours() % 4 !== 0 || new Date(observedAt).getUTCMinutes() >= 15 ||
      input.events().some((event) => event.kind === 'execution_observation' && event.detail['slot'] === slot)) return;
  try {
    const read = parallelQuotes(await input.client.latestCryptoQuotes(), input.now());
    const ids = PARALLEL_INSTRUMENTS.map(instrumentKey);
    input.append('execution_observation', `observation:${slot}`, {
      slot, decisionDay: input.day, datasetHash: input.datasetHash,
      targets: ids.map((id) => input.weights[id] ?? 0), symbols: ids.map(symbolFor),
      quotes: ids.map((id) => ({ bid: Number(read.sides[symbolFor(id)]!.bid),
        ask: Number(read.sides[symbolFor(id)]!.ask) })),
      quoteAtMs: read.observedAtMs, capturedAtMs: input.now(),
    });
  } catch (error) {
    const detail = parallelPaperFailureDetail(error, 'observation_unavailable');
    input.append('observation_error', `observation-error:${slot}:${observedAt}`, detail);
  }
}
