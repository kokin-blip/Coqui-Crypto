import type { ChannelRequest } from '@coqui/contracts';
import { capitalPerformanceView, capitalScopesView, ingestLocalPaperCapital, recordCapitalIngestionFailure, type ProfileOperationGate } from '@coqui/services';
import type { Db } from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';
import { createCapitalFeasibilityHandlers } from './capital-feasibility-handlers.js';
import { createProfitReserveHandlers } from './profit-reserve-handlers.js';

/** Capital reads and local preview settings/evidence accept no provider or execution client. */
export function createCapitalHandlers(profileId: string, database: Db, initialization?: {
  readonly nowMs: number; readonly operationGate?: ProfileOperationGate; readonly now?: () => number; readonly onError: (error: unknown) => void;
}): ChannelHandlers {
  if (initialization) {
    try { ingestLocalPaperCapital(profileId, database, initialization.nowMs); }
    catch (error) { recordCapitalIngestionFailure('local_paper', initialization.nowMs, database); initialization.onError(error); }
  }
  return {
    ...createProfitReserveHandlers(profileId, database, initialization?.now ?? (() => Date.now()), initialization?.operationGate),
    ...createCapitalFeasibilityHandlers(profileId, database, initialization?.now ?? (() => Date.now())),
    'capital.scopes': () => ({ ok: true, value: capitalScopesView(profileId, database) }),
    'capital.performance': (request: ChannelRequest<'capital.performance'>) => {
      try { return { ok: true, value: capitalPerformanceView(profileId, request, database) }; }
      catch (error) {
        if (error instanceof Error && ['capital_scope_unavailable', 'capital_epoch_unavailable', 'capital_evidence_capacity_exceeded'].includes(error.message)) {
          return { ok: false, issues: [{ path: [], code: error.message }] };
        }
        throw error;
      }
    },
  };
}
