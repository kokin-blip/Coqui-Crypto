import type { ChannelRequest } from '@coqui/contracts';
import type { PaperExecutionService } from '@coqui/services';
import type { ChannelHandlers } from './dispatch.js';
/** Refresh belongs at the authoritative boundary, never in renderer calculations. */
export function createPaperReviewHandlers(input: { service:()=>PaperExecutionService;
  refreshReview:()=>Promise<void>; refreshPreview:()=>Promise<void> }): ChannelHandlers {
  return {
    'paper.execution.preview':async(payload:ChannelRequest<'paper.execution.preview'>)=>{
      await input.refreshPreview(); return {ok:true,value:input.service().preview(payload.proposalId)};
    },
    'paper.execution.review':async(payload:ChannelRequest<'paper.execution.review'>)=>{
      await input.refreshReview(); return {ok:true,value:input.service().review(payload)};
    },
  } as ChannelHandlers;
}
