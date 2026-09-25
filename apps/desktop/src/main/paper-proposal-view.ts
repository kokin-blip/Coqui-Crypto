import type { ExecutionIntent } from '@coqui/core';
import { getLatestPaperExecutionReview,getPaperExecutionProposal,getPaperProposalEvidence,type Db } from '@coqui/storage';

export function paperProposalView(proposal:ReturnType<typeof getPaperExecutionProposal>&{},database:Db) {
  const intents=JSON.parse(proposal.intentsJson) as readonly ExecutionIntent[];
  return {id:proposal.id,runId:proposal.runId,revision:proposal.revision,
    proposalHash:proposal.proposalHash,status:proposal.status,createdAt:proposal.createdAt,
    updatedAt:proposal.updatedAt,...getPaperProposalEvidence(proposal.id,database),actions:intents.map((intent)=>({
      productId:intent.asset.instrument.productId,side:intent.side,amountUsd:String(intent.amountUsd),
      origin:'rebalance' as const})),review:getLatestPaperExecutionReview(proposal.id,database)};
}
