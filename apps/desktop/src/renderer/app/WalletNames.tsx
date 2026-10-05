import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';

type Wallet = ChannelResponse<'wallets.list'>['wallets'][number];
const INVALIDATIONS = ['wallets.list'] as const;
export function walletLabel(wallet: Wallet): string {
  return `${wallet.nickname === null ? '' : `${wallet.nickname} · `}${wallet.provider === 'coinbase' ? 'Coinbase' : 'Robinhood Crypto'} ••••${wallet.maskedSuffix}${wallet.removed ? ' · Removed' : ''}`;
}
export function useWalletNames(client: CoquiClient) {
  const wallets = useChannel(client, 'wallets.list', {});
  return {
    wallets,
    accountLabel(connectionId: string, accountRefId?: string, provider?: 'coinbase' | 'robinhood_crypto'): string {
      const matched = wallets.kind === 'ready' ? wallets.value.wallets.filter(w => w.connectionId === connectionId && (accountRefId === undefined || w.accountRefIds.includes(accountRefId))) : [];
      return matched.length ? matched.map(walletLabel).join(', ') : `${provider === undefined ? 'Account' : provider === 'coinbase' ? 'Coinbase account' : 'Robinhood Crypto account'} ${(accountRefId ?? connectionId).slice(0, 8)}…`;
    },
  };
}
function NicknameField({ client, wallet, revision }: {readonly client: CoquiClient;readonly wallet: Wallet;readonly revision: string | null}): React.JSX.Element {
  const command = useCommand(client, 'wallets.nickname.set', INVALIDATIONS);
  const [value, setValue] = useState(wallet.nickname ?? '');
  useEffect(() => { setValue(wallet.nickname ?? ''); }, [wallet.nickname]);
  const busy = command.state.kind === 'pending';
  return <form className="wallet-nickname-field" onSubmit={event => { event.preventDefault(); void command.run({commandId: crypto.randomUUID(), walletId: wallet.id, nickname: value, revision}); }}>
    <label htmlFor={`nickname-${wallet.id}`}>{walletLabel(wallet)}<input id={`nickname-${wallet.id}`} value={value} maxLength={80} disabled={busy} onChange={event => setValue(event.target.value)} placeholder="Local nickname" autoComplete="off" /></label>
    <div className="coinbase-action-row"><button type="submit" className="button-secondary" disabled={busy || !value.trim()}>{busy ? 'Saving…' : wallet.nickname === null ? 'Add nickname' : 'Save nickname'}</button><button type="button" className="button-quiet" disabled={busy || wallet.nickname === null} onClick={() => void command.run({commandId: crypto.randomUUID(),walletId:wallet.id,nickname:null,revision})}>Clear</button></div>
    {command.state.kind === 'failed' || command.state.kind === 'blocked' || command.state.kind === 'unknown' ? <SurfaceState kind="error" title="Nickname was not saved" detail={`${command.state.codes.join(', ')}. Refresh the account list if another window changed it.`} compact /> : command.state.kind === 'succeeded' ? <p role="status" className="settings-help">Saved on this installation.</p> : null}
  </form>;
}
export function WalletNicknames({ client, connectionId }: {readonly client: CoquiClient;readonly connectionId:string}): React.JSX.Element {
  const queries=useQueryClient();
  const wallets = useChannel(client, 'wallets.list', {});
  if (wallets.kind === 'loading') return <SurfaceState kind="loading" title="Loading local nicknames" compact />;
  if (wallets.kind !== 'ready') return <SurfaceState kind="error" title="Local nicknames unavailable" detail={wallets.issues.map(i=>i.code).join(', ')} compact />;
  const accounts=wallets.value.wallets.filter(w=>w.connectionId===connectionId);
  return <div className="wallet-nicknames"><button type="button" className="button-quiet" onClick={()=>void queries.invalidateQueries({queryKey:['wallets.list']})}>Refresh local names</button><p className="settings-help">Nicknames follow the verified wallet across profiles on this installation. They stay local and are excluded from exports and Advisor. Duplicate names are allowed; provider and masked identity remain visible.</p>{accounts.length === 0 ? <p className="settings-help">Verify and sync this connection before naming its wallet.</p> : accounts.map(w=><NicknameField key={w.id} client={client} wallet={w} revision={wallets.value.revision} />)}</div>;
}

/** Historical attribution stays visible even when the connector is absent from active Settings. */
export function WalletAttribution({client,connectionId}:{readonly client:CoquiClient;readonly connectionId:string}):React.JSX.Element {
  const names=useWalletNames(client);
  const status=useChannel(client,'connections.status',{connectionId});
  const label=names.accountLabel(connectionId,undefined,status.kind==='ready'?status.value.provider:undefined);
  return <span>{label}{status.kind==='ready'&&status.value.removalState==='removed'&&!label.endsWith(' · Removed')?' · Removed':''}{status.kind==='ready'&&status.value.removalState==='pending'?' · Removal pending':''}</span>;
}
