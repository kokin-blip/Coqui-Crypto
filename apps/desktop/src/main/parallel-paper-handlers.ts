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
    'parallel.paper.pause': (payload: { readonly commandId: string }) => service.transition('paused', payload.commandId)
      ? { ok: true, value: service.summary() }
      : { ok: false, issues: [{ path: [], code: 'experiment_not_active' }] },
    'parallel.paper.resume': (payload: { readonly commandId: string }) => service.transition('resumed', payload.commandId)
      ? { ok: true, value: service.summary() }
      : { ok: false, issues: [{ path: [], code: 'experiment_not_paused' }] },
    'parallel.paper.stop': async (payload: { readonly commandId: string }) => await service.stop(payload.commandId)
      ? { ok: true, value: service.summary() }
      : { ok: false, issues: [{ path: [], code: 'outstanding_orders_unresolved' }] },
  } as ChannelHandlers;
}
