import type { ChannelRequest } from '@coqui/contracts';
import { accessibleCapitalBudget, capitalFeasibilityView } from '@coqui/services';
import type { Db } from '@coqui/storage';
import type { ChannelHandlers } from './dispatch.js';

/** Local reads only. No network, credential, claim-writing, order or registration capability. */
export function createCapitalFeasibilityHandlers(profileId: string, database: Db, now: () => number): ChannelHandlers {
  const read = <T>(operation: () => T) => {
    try { return { ok: true as const, value: operation() }; }
    catch (error) {
      if (error instanceof Error && ['capital_scope_unavailable', 'budget_source_not_recorded', 'budget_proposal_unavailable', 'budget_evidence_capacity'].includes(error.message)) {
        return { ok: false as const, issues: [{ path: [], code: error.message }] };
      }
      throw error;
    }
  };
  return {
    'capital.budget': (request: ChannelRequest<'capital.budget'>) => read(() => accessibleCapitalBudget(profileId, request.scopeId, now(), database)),
    'capital.feasibility': (request: ChannelRequest<'capital.feasibility'>) => read(() => capitalFeasibilityView(profileId, request, now(), database)),
  };
}
