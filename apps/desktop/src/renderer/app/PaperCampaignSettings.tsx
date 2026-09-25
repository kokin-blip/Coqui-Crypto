import { useState } from 'react';

import type { CoquiClient } from '@coqui/contracts';
import { presentAction } from '@coqui/ui-kit';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';

const INVALIDATIONS = ['paper.campaign', 'paper.campaign.connections', 'app.status-rail', 'activity.feed'] as const;

export function PaperCampaignSettings({ client }: {
  readonly client: CoquiClient;
}): React.JSX.Element {
  const campaign = useChannel(client, 'paper.campaign', {});
  const command = useCommand(client, 'paper.campaign.kill-switch', INVALIDATIONS);
  const connectionCampaign = useChannel(client, 'paper.campaign.connections', {});
  const startConnections = useCommand(client, 'paper.campaign.connections.start', INVALIDATIONS);
  const [confirmed, setConfirmed] = useState(false);
  const [connectionConfirmed, setConnectionConfirmed] = useState(false);
  const action = presentAction(command.state, {
    idle: 'Record safety exercise', pending: 'Recording…',
  }, 'consequential');
  const value = campaign.kind === 'ready' ? campaign.value : null;

  return (
    <section aria-labelledby="paper-campaign-heading" className="settings-section">
      <div>
        <p className="eyebrow">Operational evidence</p>
        <h3 id="paper-campaign-heading">Seven-day paper campaign</h3>
        {value === null
          ? <p className="muted">Starts with the first real prospective scheduler observation.</p>
          : <p className="muted">
              {value.observedDays}/7 observed UTC days · legacy exercise{' '}
              {value.killSwitchExercised ? 'recorded' : 'not recorded'} · review{' '}
              {value.killSwitchAcknowledged ? 'recorded' : 'pending'} · reconciliation{' '}
              {value.reconciled ? 'complete' : 'pending'}.
            </p>}
      </div>
      {value !== null && !value.killSwitchAcknowledged && (
        <label className="confirmation-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => { setConfirmed(event.target.checked); command.reset(); }}
          />
          {value.killSwitchExercised
            ? 'I reviewed the recorded campaign exercise.'
            : 'I understand this records a campaign exercise without stopping paper trading.'}
        </label>
      )}
      {value !== null && !value.killSwitchExercised && (
        <button
          type="button"
          className="button-primary"
          disabled={action.disabled || !confirmed}
          onClick={() => void command.run({
            commandId: crypto.randomUUID(), action: 'exercise', explicitConfirmation: true,
          })}
        >
          {action.label}
        </button>
      )}
      {value?.killSwitchExercised === true && !value.killSwitchAcknowledged && (
        <><p className="muted">Reviewing this legacy exercise completes the campaign record. It does not control paper scheduling or Alpaca orders.</p><button
          type="button"
          className="button-primary"
          disabled={action.disabled || !confirmed}
          onClick={() => void command.run({
            commandId: crypto.randomUUID(), action: 'acknowledge', explicitConfirmation: true,
          })}
        >
          Record campaign review
        </button></>
      )}
      <span aria-live="polite">{action.liveMessage}</span>
      <div className="settings-divider" />
      <div><p className="eyebrow">Connection-isolated simulator</p><h3>Multi-connection paper campaign</h3>
        <p className="muted">{connectionCampaign.kind === 'ready' && connectionCampaign.value !== null
          ? `${connectionCampaign.value.connectionCount} connection books · started ${new Date(connectionCampaign.value.startedAtMs).toLocaleString()}`
          : 'Starts prospectively from a complete, fully priced connected portfolio. Existing paper books are never reseeded.'}</p></div>
      {connectionCampaign.kind === 'ready' && connectionCampaign.value === null && <>
        <label className="confirmation-check"><input type="checkbox" checked={connectionConfirmed}
          onChange={(event) => setConnectionConfirmed(event.target.checked)} /> I understand this creates new immutable simulated books and does not modify any real account.</label>
        <button type="button" className="button-primary" disabled={!connectionConfirmed || startConnections.state.kind === 'pending'}
          onClick={() => void startConnections.run({ commandId: crypto.randomUUID(), explicitConfirmation: true })}>
          {startConnections.state.kind === 'pending' ? 'Starting…' : 'Start multi-connection paper campaign'}
        </button>
      </>}
      {startConnections.state.kind === 'failed' && <p role="alert" className="action-error">{startConnections.state.codes.join(', ')}</p>}
    </section>
  );
}
