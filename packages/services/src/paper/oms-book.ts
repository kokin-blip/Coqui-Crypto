import { instrumentKey } from '@coqui/core';
import { listExploratoryPaperBalances, listPaperBalances, type Db } from '@coqui/storage';
import { Decimal } from 'decimal.js';

import type { ApprovedExecution } from './execution-gate.js';

function balances(approval: Pick<ApprovedExecution, 'profileId' | 'campaignId'>, database: Db) {
  return approval.campaignId === null
    ? listPaperBalances(approval.profileId, database)
    : listExploratoryPaperBalances(approval.campaignId, approval.profileId, database);
}

export function availableForPaperIntentUsd(
  approval: Pick<ApprovedExecution, 'profileId' | 'campaignId'>,
  side: 'buy' | 'sell',
  instrument: ApprovedExecution['intents'][number]['asset']['instrument'],
  priceUsd: string,
  database: Db,
): string {
  const book = balances(approval, database);
  if (side === 'buy') {
    return book.find((balance) => 'exposureKey' in balance
      ? balance.exposureKey === 'USD'
      : balance.assetId === 'USD')?.quantity ?? '0';
  }
  const quantity = book.find((balance) => 'exposureKey' in balance
    ? balance.assetId === instrumentKey(instrument)
    : balance.assetId === instrumentKey(instrument))?.quantity ?? '0';
  return new Decimal(quantity).mul(priceUsd).toFixed();
}
