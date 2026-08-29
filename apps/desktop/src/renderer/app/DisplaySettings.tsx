import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { presentAction } from '@coqui/ui-kit';

import { useCommand } from '../query/use-command.js';

type Preferences = ChannelResponse<'accounts.settings'>['preferences'];
const INVALIDATIONS = ['accounts.settings'] as const;

export function DisplaySettings({
  client,
  preferences,
}: {
  readonly client: CoquiClient;
  readonly preferences: Preferences;
}): React.JSX.Element {
  const command = useCommand(client, 'accounts.settings.set', INVALIDATIONS);
  const action = presentAction(command.state, { idle: '', pending: 'Saving display preference…' });
  const save = (patch: Parameters<typeof command.run>[0]['patch']): void => {
    void command.run({ commandId: crypto.randomUUID(), patch });
  };

  return (
    <div className="settings-control-grid">
      <label>Theme
        <select value={preferences.theme} disabled={action.disabled} onChange={(event) => save({ theme: event.target.value as Preferences['theme'] })}>
          <option value="system">System</option><option value="dark">Dark</option>
          <option value="light">Light</option><option value="high_contrast">High contrast</option>
        </select>
      </label>
      <label>Density
        <select value={preferences.density} disabled={action.disabled} onChange={(event) => save({ density: event.target.value as Preferences['density'] })}>
          <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
        </select>
      </label>
      <label>Motion
        <select value={preferences.motion} disabled={action.disabled} onChange={(event) => save({ motion: event.target.value as Preferences['motion'] })}>
          <option value="system">System</option><option value="reduced">Reduced</option><option value="none">None</option>
        </select>
      </label>
      <label>Language
        <select value={preferences.language} disabled={action.disabled} onChange={(event) => save({ language: event.target.value as Preferences['language'] })}>
          <option value="en">English</option><option value="es">Español</option>
        </select>
      </label>
      <span className="sr-only" aria-live="polite">{action.liveMessage}</span>
    </div>
  );
}
