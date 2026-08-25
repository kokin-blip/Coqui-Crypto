import { useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';

import type { CoquiClient } from '@coqui/contracts';
import { presentAction } from '@coqui/ui-kit';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';

const PROFILE_INVALIDATIONS = ['accounts.profiles'] as const;

export function ProfileSwitcher({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const profiles = useChannel(client, 'accounts.profiles', {});
  const command = useCommand(client, 'accounts.profile.switch', PROFILE_INVALIDATIONS);
  const queryClient = useQueryClient();

  useLayoutEffect(() => {
    if (command.value === null) return;
    // Reset synchronously before paint: no value from the prior database may
    // survive the confirmed main-process context swap.
    void queryClient.resetQueries({
      predicate: (query) => query.queryKey[0] !== 'accounts.profile.switch',
    });
  }, [command.value, queryClient]);

  if (profiles.kind !== 'ready') return <strong>PROFILE —</strong>;
  const presentation = presentAction(command.state, {
    idle: 'Switch profile',
    pending: 'Switching…',
  });

  return (
    <label className="profile-switcher">
      <strong>PROFILE</strong>
      <select
        aria-label="Active profile"
        value={profiles.value.activeProfile.id}
        disabled={presentation.disabled}
        onChange={(event) => {
          const profileId = event.target.value;
          if (profileId === profiles.value.activeProfile.id) return;
          void command.run({ commandId: crypto.randomUUID(), profileId });
        }}
      >
        {profiles.value.profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>{profile.name}</option>
        ))}
      </select>
      <span className="sr-only" aria-live="polite">{presentation.liveMessage}</span>
    </label>
  );
}
