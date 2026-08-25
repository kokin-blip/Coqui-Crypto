import { useState } from 'react';

import type { CoquiClient } from '@coqui/contracts';
import { presentAction } from '@coqui/ui-kit';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';

const INVALIDATIONS = ['paper.execution.policy', 'app.status-rail'] as const;

export function ExecutionPolicySettings({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const policy = useChannel(client, 'paper.execution.policy', {});
  const command = useCommand(client, 'paper.execution.policy.set', INVALIDATIONS);
  const [mode, setMode] = useState<'off' | 'review_required' | 'unattended'>('review_required');
  const [confirmed, setConfirmed] = useState(false);
  const action = presentAction(command.state, { idle: 'Save paper policy', pending: 'Saving…' }, 'consequential');

  return (
    <section aria-labelledby="execution-policy-heading" className="settings-section">
      <div>
        <p className="eyebrow">Paper safety</p>
        <h3 id="execution-policy-heading">Execution policy</h3>
        <p className="muted">
          Current: {policy.kind === 'ready' ? policy.value.mode.replaceAll('_', ' ') : 'unavailable'}.
          Live execution remains disabled in every mode.
        </p>
      </div>
      <label>
        Paper operating mode
        <select
          value={mode}
          disabled={action.disabled}
          onChange={(event) => {
            setMode(event.target.value as typeof mode);
            setConfirmed(false);
            command.reset();
          }}
        >
          <option value="review_required">Review required</option>
          <option value="off">Off — read only</option>
          <option value="unattended">Unattended paper</option>
        </select>
      </label>
      {mode === 'unattended' && (
        <label className="confirmation-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I understand system approval still runs every gate and applies only to paper trading.
        </label>
      )}
      <button
        type="button"
        className="button-primary"
        disabled={action.disabled || mode === 'unattended' && !confirmed}
        onClick={() => void command.run({
          commandId: crypto.randomUUID(),
          mode,
          explicitUnattendedConfirmation: mode === 'unattended' && confirmed,
        })}
      >
        {action.label}
      </button>
      <span aria-live="polite">{action.liveMessage}</span>
    </section>
  );
}
