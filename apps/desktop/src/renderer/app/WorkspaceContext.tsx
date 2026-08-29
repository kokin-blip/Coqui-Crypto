import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';

export type WorkspaceMode = 'advanced' | 'simple';
type WorkspaceView = ChannelResponse<'accounts.workspace'>;

interface WorkspaceContextValue {
  readonly mode: WorkspaceMode;
  readonly preferences: WorkspaceView['preferences'] | null;
  readonly pending: boolean;
  setMode(mode: WorkspaceMode): Promise<void>;
  update(patch: Partial<WorkspaceView['preferences']>): Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const INVALIDATIONS = ['accounts.workspace', 'accounts.settings'] as const;

export function WorkspaceProvider({
  children,
  client,
}: {
  readonly children: ReactNode;
  readonly client: CoquiClient;
}): React.JSX.Element {
  const workspace = useChannel(client, 'accounts.workspace', {});
  const command = useCommand(client, 'accounts.workspace.set', INVALIDATIONS);
  const preferences = workspace.kind === 'ready' ? workspace.value.preferences : null;
  const value = useMemo<WorkspaceContextValue>(() => {
    const update = async (patch: Partial<WorkspaceView['preferences']>): Promise<void> => {
      await command.run({ commandId: crypto.randomUUID(), patch });
    };
    return {
      mode: preferences?.workspaceMode ?? 'advanced',
      preferences,
      pending: command.state.kind === 'pending',
      setMode: async (mode) => {
        if (mode === (preferences?.workspaceMode ?? 'advanced')) return;
        await update({ workspaceMode: mode });
      },
      update,
    };
  }, [command, preferences]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (value === null) throw new Error('WorkspaceProvider is missing.');
  return value;
}
