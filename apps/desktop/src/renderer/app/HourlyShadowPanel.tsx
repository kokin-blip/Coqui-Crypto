import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { useEffect, useRef } from 'react';
import { useCommand } from '../query/use-command.js';
import { exactUtcTimestamp, formatLocalTimestamp } from './time-format.js';

type Shadow = ChannelResponse<'parallel.paper.status'>['hourlyShadow'];
const INVALIDATES = ['parallel.paper.status'] as const;
const STATE_LABELS = { unregistered: 'awaiting registration', source_mismatch: 'registered source changed',
  scheduled: 'scheduled', collecting: 'collecting hourly observations', ended: 'study ended', invalid: 'registration needs review' };
const ERRORS: Record<string, string> = {
  hourly_study_preview_stale: 'The study or app changed. Review a new preview before registering.',
  connection_operation_in_progress: 'A profile check is running. Try registering again after it finishes.',
  study_not_registered: 'No prior study definition is available to restart. The original research plan needs registration first.',
  hourly_candidate_version_changed: 'The frozen research policy changed and requires a separately registered candidate.',
};
function timestamp(at: number) {
  return <time dateTime={exactUtcTimestamp(at)} title={exactUtcTimestamp(at)}>{formatLocalTimestamp(at)}</time>;
}
export function HourlyShadowPanel({ client, shadow, stopped }: {
  readonly client: CoquiClient; readonly shadow: Shadow; readonly stopped: boolean;
}): React.JSX.Element {
  const preview = useCommand(client, 'parallel.paper.hourly-study.preview');
  const restart = useCommand(client, 'parallel.paper.hourly-study.restart', INVALIDATES);
  const button = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null), title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (preview.value) heading.current?.focus(); }, [preview.value]);
  const issue = [restart, preview].find(command => ['failed', 'blocked', 'unknown'].includes(command.state.kind));
  const codes = issue && 'codes' in issue.state ? issue.state.codes : [];
  const needsRestart = ['source_mismatch', 'unregistered', 'ended', 'invalid'].includes(shadow.registrationState);
  const close = () => { preview.reset(); restart.reset(); button.current?.focus(); };
  const confirm = async () => {
    if (!preview.value) return;
    const result = await restart.run({ commandId: crypto.randomUUID(), previewHash: preview.value.previewHash });
    if ('status' in result && result.status === 'ok') { preview.reset(); title.current?.focus(); }
  };
  return <section className="parallel-paper-decision" aria-label="Hourly execution research">
    <h3 ref={title} tabIndex={-1}>Hourly execution candidate · shadow only</h3>
    <p className="muted">The Alpaca paper policy still uses five four-hour slots. This candidate checks the same completed daily TrendVol target hourly in an independent modeled account; its orders are not sent to Alpaca.</p>
    <p role="status">Current study: {STATE_LABELS[shadow.registrationState]}{shadow.startMs !== null &&
      <> · {shadow.registrationState === 'scheduled' ? 'starts' : 'started'} {timestamp(shadow.startMs)}</>}.</p>
    <p>{shadow.completeDays} complete 24-hour days · {shadow.observationCount} hourly observations in this study.</p>
    {shadow.registrationState === 'source_mismatch' && <p>The installed code differs from the registered source. Start a fresh study to collect new observations. Earlier records are preserved separately.</p>}
    {shadow.registrationState === 'scheduled' && <p className="muted">Collection begins at the scheduled start while Coqui is open and awake. Missed hours remain gaps.</p>}
    {shadow.registrationState === 'collecting' && <p className="muted">Collection can continue while broker orders are paused. Fresh completed bars and quotes are required during the first 15 minutes of each hour.</p>}
    {shadow.lastSlotMs !== null && <p>Latest shadow check {timestamp(shadow.lastSlotMs)} · {shadow.lastModeledOrderCount} modeled {shadow.lastModeledOrderCount === 1 ? 'order' : 'orders'}
      {shadow.lastBlockedReasons.length > 0 ? ` · blocked: ${shadow.lastBlockedReasons.join(', ')}` : ''}.
      Modeled fills and costs are research assumptions, not Alpaca activity.</p>}
    {shadow.lastModeledOrders.length > 0 && <ul>{shadow.lastModeledOrders.map((order, index) => <li key={`${order.symbol}:${order.side}:${index}`}>
      Virtual {order.side} {order.symbol}: {order.filledQuantity} filled of {order.quantity} modeled units
      {Number(order.remainingQuantity) > 0 ? ` · ${order.remainingQuantity} pending` : ''}</li>)}</ul>}
    {shadow.lastFailureReason !== null && shadow.registrationState !== 'source_mismatch' && <p className="muted">Latest shadow read unavailable: {shadow.lastFailureReason.replaceAll('_', ' ')}.</p>}
    {!stopped && needsRestart && <button type="button" className="button-secondary" ref={button}
      disabled={preview.state.kind === 'pending' || restart.state.kind === 'pending'}
      onClick={() => { restart.reset(); void preview.run({}); }}>
      {preview.state.kind === 'pending' ? 'Preparing study preview…' : 'Review fresh hourly study'}</button>}
    {preview.value && <div className="hourly-study-preview" aria-labelledby="hourly-study-preview-heading">
      <h4 id="hourly-study-preview-heading" ref={heading} tabIndex={-1}>Review hourly study registration</h4>
      <p>{preview.value.alreadyRegistered ? 'A compatible study is already registered.' : <>New collection starts {timestamp(preview.value.startMs)}.</>}
        {' '}Earlier records stay intact; missed observations cannot be recreated.</p>
      <p>Same frozen target, trade rules, and modeled costs · $100,000 virtual opening cash · ends {timestamp(preview.value.holdoutEndMs)}.</p>
      <details><summary>Study dates and source identity</summary>
        <p>Development folds end: {preview.value.foldEndsMs.map(formatLocalTimestamp).join(' · ')}</p>
        <p>Behavior source: <code>{preview.value.behaviorHash}</code></p>
        <p>App artifact: <code>{preview.value.artifactHash}</code></p>
        <p>Prior study: <code>{preview.value.previousStudyId ?? 'legacy registration'}</code></p>
      </details>
      <p>Research registration leaves broker trading paused and does not promote this candidate.</p>
      <div className="settings-actions"><button type="button" className="button-primary" disabled={restart.state.kind === 'pending' || restart.state.kind === 'unknown'} onClick={() => void confirm()}>
        {restart.state.kind === 'pending' ? 'Registering study…' : preview.value.alreadyRegistered ? 'Keep registered study' : 'Register fresh hourly study'}</button>
        <button type="button" className="button-secondary" disabled={restart.state.kind === 'pending'} onClick={close}>Cancel</button></div>
    </div>}
    {restart.state.kind === 'succeeded' && <p role="status">Hourly study registered. Collection starts {restart.value && timestamp(restart.value.startMs)}.</p>}
    {issue && <p className="action-error" role="alert">{codes.map(code => ERRORS[code] ?? (issue.state.kind === 'unknown'
      ? 'Registration could not be confirmed. Refresh the study status before trying again.' : 'The hourly study could not be registered. Review a fresh preview and try again.')).join(' ')}</p>}
  </section>;
}
