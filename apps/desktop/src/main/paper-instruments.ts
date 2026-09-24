import type { InstrumentIdentity } from '@coqui/core';
import { currentExploratoryPaperCampaign, getAllocationPolicy, type Db } from '@coqui/storage';

export function paperInstruments(profileId: string, database: Db): readonly InstrumentIdentity[] {
  const exploratory = currentExploratoryPaperCampaign(profileId, database);
  if (exploratory !== null && exploratory.status !== 'stopped') {
    return exploratory.campaign.baseWeights.map(({ assetId }) => {
      const [, , productId] = assetId.split('|');
      if (!productId) throw new Error('Invalid exploratory campaign instrument.');
      return { venue: 'coinbase', productType: 'spot', productId };
    });
  }
  return getAllocationPolicy(database).targets.map((target) => target.instrument);
}
