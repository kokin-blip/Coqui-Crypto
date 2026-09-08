import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { ConnectionManager } from './ConnectionManager.js';
import { DisplaySettings } from './DisplaySettings.js';
import { ExecutionPolicySettings } from './ExecutionPolicySettings.js';
import { PaperCampaignSettings } from './PaperCampaignSettings.js';
import { SurfaceState } from './SurfaceState.js';
import { useChannel } from '../query/use-channel.js';
import { WorkspaceSettings } from './WorkspaceSettings.js';

type SettingsView = ChannelResponse<'accounts.settings'>;

/**
 * Presentation preferences.
 *
 * Accounts owns theme, density, motion and language and nothing else. Every
 * financial, tax, provider and strategy setting the predecessor kept here is
 * excluded by the service, which rejects them rather than dropping them
 * silently — so this screen has nothing to show for them either.
 *
 * Every change is confirmed by a durable, profile-scoped command before the
 * interface reports success.
 */
export function Settings({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const settings = useChannel(client, 'accounts.settings', {});

  if (settings.kind === 'loading') return <SurfaceState kind="loading" title="Loading settings" />;
  if (settings.kind !== 'ready') {
    return <SurfaceState kind="error" title="Could not load settings" detail={settings.issues.map((issue) => issue.code).join(', ')} />;
  }

  const view: SettingsView = settings.value;

  return (
    <section aria-labelledby="settings-heading" className="space-y-4">
      <h2 id="settings-heading" className="font-semibold">
        Settings
      </h2>

      <section className="settings-section" aria-labelledby="appearance-settings-heading">
        <div><p className="section-label">Profile presentation</p><h3 id="appearance-settings-heading">Appearance and access</h3></div>
        <DisplaySettings client={client} preferences={view.preferences} />
        <p className="opacity-70">{view.source === 'default' ? 'Using verified workstation defaults for this profile.' : 'Saved for this profile.'}</p>
      </section>

      <section className="settings-section" aria-labelledby="workspace-settings-heading">
        <div><p className="section-label">Workspace</p><h3 id="workspace-settings-heading">Mode and chart defaults</h3></div>
        <WorkspaceSettings client={client} preferences={view.preferences} />
      </section>

      <ExecutionPolicySettings client={client} />
      <PaperCampaignSettings client={client} />

      <ConnectionManager key={view.profileId} client={client} />
    </section>
  );
}
