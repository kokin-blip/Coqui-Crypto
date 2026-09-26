import type { HttpClient, SecretStore } from '@coqui/adapters';
import type { Clock } from '@coqui/core';
import { isRecoverableParallelMarketPause, ParallelPaperService, PARALLEL_INSTRUMENTS, resolveKillSwitch } from '@coqui/services';
import { latestParallelExperiment, listParallelEvents, parallelExperimentStatus, type Db } from '@coqui/storage';

import { createPaperMarketFeed, type PaperMarketFeedDependencies } from './paper-market.js';

export function createParallelPaperRuntime(input: {
  readonly profileId: string;
  readonly database: Db;
  readonly clock: Clock;
  readonly http: HttpClient;
  readonly bars: PaperMarketFeedDependencies['bars'];
  readonly secrets?: SecretStore;
  readonly onUnexpectedError: (context: string, error: unknown) => void;
}) {
  const market = createPaperMarketFeed({ database: input.database, http: input.http,
    instruments: () => PARALLEL_INSTRUMENTS, bars: input.bars,
    onUnexpectedError: input.onUnexpectedError });
  const service = new ParallelPaperService({ profileId: input.profileId,
    database: input.database, clock: input.clock,
    ...(input.secrets === undefined ? {} : { secrets: input.secrets }),
    preparation: market.preparation, refreshFor: market.refresh,
    killSwitchEngaged: () => resolveKillSwitch(input.profileId, input.database).engaged });
  return { service,
    async refreshIfActive(nowMs: number): Promise<void> {
      const experiment = latestParallelExperiment(input.profileId, input.database);
      const events = experiment === null ? [] : listParallelEvents(experiment.id, input.profileId, input.database);
      const status = parallelExperimentStatus(events);
      const latestState = [...events].reverse().find((event) =>
        ['paused', 'resumed', 'stopped', 'started'].includes(event.kind));
      if (experiment !== null && (status === 'active' ||
          (status === 'paused' && isRecoverableParallelMarketPause(latestState?.detail['reason'])))) {
        await market.refresh(nowMs);
      }
    },
  };
}
