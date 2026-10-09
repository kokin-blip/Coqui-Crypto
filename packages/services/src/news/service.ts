import { newsObservationSchema } from '@coqui/contracts';
import type { Clock, StoredNewsObservation } from '@coqui/core';
import { inTransaction, listNewsObservationsAsOf, saveNewsObservation,
  type Db, type NewsSaveResult } from '@coqui/storage';

/** Fixture/storage foundation only: does not fetch, schedule, classify, or trigger research. */
export class NewsStorageService {
  constructor(private readonly input: { readonly database: Db; readonly clock: Clock }) {}

  ingest(values: unknown): readonly NewsSaveResult[] {
    if (!Array.isArray(values) || values.length < 1 || values.length > 250) {
      throw new TypeError('Invalid news observation batch.');
    }
    const observations = values.map(value => {
      const parsed = newsObservationSchema.safeParse(value);
      // Never include validation input, article URLs, or arbitrary payloads in errors.
      if (!parsed.success) throw new TypeError('Invalid news observation batch.');
      return parsed.data;
    });
    const persistedAtMs = this.input.clock.nowMs();
    return inTransaction(this.input.database, () => Object.freeze(observations.map(observation =>
      saveNewsObservation(observation, persistedAtMs, this.input.database))));
  }

  asOf(asOfMs: number, limit = 100): readonly StoredNewsObservation[] {
    if (asOfMs > this.input.clock.nowMs()) throw new TypeError('News historical cutoff is in the future.');
    return listNewsObservationsAsOf(asOfMs, limit, this.input.database);
  }
}
