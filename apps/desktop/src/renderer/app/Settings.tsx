import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { DeferredPanel } from './DeferredPanel.js';
import { useChannel } from '../query/use-channel.js';

type SettingsView = ChannelResponse<'accounts.settings'>;

/**
 * Presentation preferences.
 *
 * Accounts owns theme, density, motion and language and nothing else. Every
 * financial, tax, provider and strategy setting the predecessor kept here is
 * excluded by the service, which rejects them rather than dropping them
 * silently — so this screen has nothing to show for them either.
 *
 * Read-only for now: writing needs the action-feedback contract wired to a
 * write channel, and there are no write channels before P6.
 */
export function Settings({
  client,
  profileId,
}: {
  readonly client: CoquiClient;
  readonly profileId: string;
}): React.JSX.Element {
  const settings = useChannel(client, 'accounts.settings', { profileId });

  if (settings.kind === 'loading') return <p aria-live="polite">Loading settings…</p>;
  if (settings.kind !== 'ready') {
    return (
      <p role="alert">
        Could not load settings: {settings.issues.map((issue) => issue.code).join(', ')}
      </p>
    );
  }

  const view: SettingsView = settings.value;

  return (
    <section aria-labelledby="settings-heading" className="space-y-4">
      <h2 id="settings-heading" className="font-semibold">
        Settings
      </h2>

      <dl className="grid grid-cols-[10rem_1fr] gap-x-4">
        <dt>theme</dt>
        <dd>{view.preferences.theme}</dd>
        <dt>density</dt>
        <dd>{view.preferences.density}</dd>
        <dt>motion</dt>
        <dd>{view.preferences.motion}</dd>
        <dt>language</dt>
        <dd>{view.preferences.language}</dd>
      </dl>

      {/* source distinguishes an unset default from an explicit choice. */}
      <p className="opacity-70">
        {view.source === 'default'
          ? 'These are the defaults — nothing has been changed for this profile.'
          : 'Saved for this profile.'}
      </p>

      <DeferredPanel
        title="Data sources"
        phase="P7"
        reason="The optional CoinGecko key is entered here once the secret-safe connection service ships alongside the Coinbase connect flow."
      />
    </section>
  );
}
