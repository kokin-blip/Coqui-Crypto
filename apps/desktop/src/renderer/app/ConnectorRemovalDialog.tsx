import type { CoquiClient } from '@coqui/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';

export const CONNECTION_INVALIDATIONS = ['connections.list', 'wallets.list', 'portfolio.current', 'portfolio.history', 'app.profile-readiness', 'app.status-rail'] as const;
export function ConnectorRemovalDialog({client, connectionId, action, returnFocus, onClose}: {readonly client: CoquiClient;readonly connectionId:string;readonly action:'remove'|'disconnect';readonly returnFocus:HTMLButtonElement|null;readonly onClose:()=>void}): React.JSX.Element {
  const ref=useRef<HTMLDialogElement>(null);
  const queries=useQueryClient();
  const preview=useChannel(client,'connections.removal-preview',{connectionId});
  const remove=useCommand(client,'connections.remove',CONNECTION_INVALIDATIONS);
  const disconnect=useCommand(client,'connections.disconnect',CONNECTION_INVALIDATIONS);
  const command=action==='remove'?remove:disconnect;
  useEffect(()=>{ref.current?.showModal(); return ()=>{ref.current?.close();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});};},[returnFocus]);
  useEffect(()=>{if(command.state.kind==='succeeded'){onClose();requestAnimationFrame(()=>document.querySelector<HTMLElement>('[data-route-heading]')?.focus({preventScroll:true}));}},[command.state.kind,onClose]);
  const busy=command.state.kind==='pending';
  async function confirm():Promise<void> {
    if(preview.kind!=='ready'||!preview.value.eligible)return;
    if(action==='remove')await remove.run({commandId:crypto.randomUUID(),connectionId,revision:preview.value.revision,confirmed:true});
    else await disconnect.run({commandId:crypto.randomUUID(),connectionId,revision:preview.value.revision,confirmed:true});
    // Interrupted cleanup is a durable mutation too: remove its balances from cached UI.
    await Promise.all(CONNECTION_INVALIDATIONS.map(name=>queries.invalidateQueries({queryKey:[name]})));
    await queries.invalidateQueries({queryKey:['connections.removal-preview']});
  }
  return <dialog ref={ref} className="account-confirmation" aria-labelledby="account-removal-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <form method="dialog" onSubmit={event=>event.preventDefault()}><header><p className="section-label">Connection lifecycle</p><h2 id="account-removal-title">{action==='remove'?'Remove Coinbase connector':'Disconnect connector'}</h2></header>
    {preview.kind==='loading'?<SurfaceState kind="loading" title="Checking balances and active workflows" compact />:preview.kind!=='ready'?<SurfaceState kind="error" title="Could not check this connector" detail={preview.issues.map(i=>i.code).join(', ')} compact />:<><p><strong>{preview.value.label}</strong> · {preview.value.provider} · <code>{connectionId.slice(0,12)}…</code> · {preview.value.status.replaceAll('_',' ')}</p><p>Stored credentials will be removed locally. Its cached balances will stop contributing to the current portfolio. {action==='remove'?'The connector will disappear from active Settings.':'The disconnected row will remain in Settings.'} This does not revoke the key or delete the remote account.</p><p>{preview.value.retainedSnapshots} historical snapshot{preview.value.retainedSnapshots===1?'':'s'} will be retained, together with account references, routing records and campaign evidence. Nicknames remain available for a verified reconnect.</p>
    <details><summary>Balances excluded from current holdings ({preview.value.affectedBalances.length})</summary>{preview.value.affectedBalances.length===0?<p>No recorded balances.</p>:<ul>{preview.value.affectedBalances.map(b=><li key={b.asset}>{b.asset}: {b.quantity}</li>)}</ul>}</details>
    {preview.value.removalState==='pending'&&<SurfaceState kind="blocked" title="Cleanup needs recovery" detail="Current balances and routing are already excluded. Confirm again to retry credential cleanup safely." compact />}
    {!preview.value.eligible&&<SurfaceState kind="blocked" title="Connector is in use" detail={`${preview.value.blockers.map(c=>c.replaceAll('_',' ')).join('; ')}. Pause or stop dependent workflows and wait for synchronization and pending executions to finish, then refresh this check.`} action={{label:'Open paper workflows',href:'#/paper/overview'}} compact />}</>}
    {command.state.kind==='failed'||command.state.kind==='blocked'||command.state.kind==='unknown'?<SurfaceState kind="error" title="Cleanup was not confirmed complete" detail={`${command.state.codes.join(', ')}. Refresh the check; interrupted removals remain excluded until recovery completes.`} compact />:null}
    <footer><button autoFocus type="button" className="button-quiet" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="button-secondary" disabled={busy} onClick={()=>void queries.invalidateQueries({queryKey:['connections.removal-preview']})}>Refresh check</button><button type="button" className="button-destructive" disabled={busy||preview.kind!=='ready'||!preview.value.eligible} onClick={()=>void confirm()}>{busy?'Cleaning up…':preview.kind==='ready'&&preview.value.removalState==='pending'?'Confirm recovery':action==='remove'?'Remove connector and credentials':'Disconnect and remove credentials'}</button></footer></form>
  </dialog>;
}
