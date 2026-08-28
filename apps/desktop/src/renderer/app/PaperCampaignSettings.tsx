import { useState } from 'react';

import type { CoquiClient } from '@coqui/contracts';
import { presentAction } from '@coqui/ui-kit';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';

const INVALIDATIONS = ['paper.campaign', 'app.status-rail', 'activity.feed'] as const;

export function PaperCampaignSettings({ client }: {
  readonly client: CoquiClient;
}): React.JSX.Element {
  const campaign = useChannel(client, 'paper.campaign', {});
  const command = useCommand(client, 'paper.campaign.kill-switch', INVALIDATIONS);
  const [confirmed, setConfirmed] = useState(false);
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
              {value.observedDays}/7 observed UTC days · safety stop{' '}
              {value.killSwitchExercised ? 'exercised' : 'not exercised'} · acknowledgement{' '}
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
          I understand this engages the paper safety stop and requires an explicit acknowledgement.
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
        <button
          type="button"
          className="button-primary"
          disabled={action.disabled || !confirmed}
          onClick={() => void command.run({
            commandId: crypto.randomUUID(), action: 'acknowledge', explicitConfirmation: true,
          })}
        >
          Acknowledge and restore paper scheduling
        </button>
      )}
      <span aria-live="polite">{action.liveMessage}</span>
    </section>
  );
}
