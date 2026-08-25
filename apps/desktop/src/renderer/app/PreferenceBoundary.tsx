import { useLayoutEffect } from 'react';

import type { CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';

export function PreferenceBoundary({ client }: { readonly client: CoquiClient }): null {
  const settings = useChannel(client, 'accounts.settings', {});
  useLayoutEffect(() => {
    if (settings.kind !== 'ready') return;
    const { theme, density, motion } = settings.value.preferences;
    const root = document.documentElement;
    root.dataset['theme'] = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : theme.replace('_', '-');
    root.dataset['density'] = density;
    if (motion === 'system') delete root.dataset['motion'];
    else root.dataset['motion'] = motion;
  }, [settings]);
  return null;
}
