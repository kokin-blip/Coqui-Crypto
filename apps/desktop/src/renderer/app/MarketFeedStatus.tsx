import { Radio } from 'lucide-react';

import type { CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';
import type { WorkstationInterval } from './chart-workstation-types.js';

export function MarketFeedStatus({ client, productId, interval }: { readonly client: CoquiClient;
  readonly productId: string; readonly interval: WorkstationInterval }): React.JSX.Element {
  const live = useChannel(client, 'market-data.live-candles', { productIds: [productId], interval });
  const connection = live.kind === 'ready' ? live.value.connection : 'offline';
  return <span className={`market-feed-chip connection-${connection}`}>
    <Radio size={13} aria-hidden="true" /> Display feed {live.kind === 'ready' ? connection : 'unavailable'}
  </span>;
}
