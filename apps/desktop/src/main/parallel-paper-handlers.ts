import type { ParallelPaperService } from '@coqui/services';

import type { ChannelHandlers } from './dispatch.js';

export function createParallelPaperHandlers(service: ParallelPaperService): ChannelHandlers {
  return {
    'parallel.paper.status': () => ({ ok: true, value: service.summary() }),
    'parallel.paper.start': async (payload: { readonly commandId: string; readonly smokeVerified: true }) => {
      const result = await service.start(payload.commandId, payload.smokeVerified);
      return result.ok ? { ok: true, value: service.summary() }
        : { ok: false, issues: [{ path: [], code: result.code }] };
    },
    'parallel.paper.reconcile': async () => { await service.retryReconciliation(); return { ok: true, value: service.summary() }; },
    'parallel.paper.pause': (payload: { readonly commandId: string }) => service.transition('paused', payload.commandId)
      ? { ok: true, value: service.summary() }
      : { ok: false, issues: [{ path: [], code: 'experiment_not_active' }] },
    'parallel.paper.resume': async (payload: { readonly commandId: string }) => {
      const paused = service.status();
      if (paused.status !== 'paused') return { ok: false, issues: [{ path: [], code: 'experiment_not_paused' }] };
      const pauseId = paused.events.findLast(event => event.kind === 'paused')?.id;
      await service.retryReconciliation();
      const current = service.status();
      // Recovery must not override a pause issued after this Resume command.
      if (current.experiment?.id !== paused.experiment?.id || current.events.findLast(event => event.kind === 'paused')?.id !== pauseId)
        return { ok: false, issues: [{ path: [], code: 'paper_resume_blocked' }] };
      return service.transition('resumed', payload.commandId) ? { ok: true, value: service.summary() }
        : { ok: false, issues: [{ path: [], code: 'paper_resume_blocked' }] };
    },
    'parallel.paper.stop': async (payload: { readonly commandId: string }) => await service.stop(payload.commandId)
      ? { ok: true, value: service.summary() }
      : { ok: false, issues: [{ path: [], code: 'outstanding_orders_unresolved' }] },
  } as ChannelHandlers;
}
