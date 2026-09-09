import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';
import { shellStateForWidth, type WorkspaceShellState } from './workspace-layout.js';

export type WorkspaceMode = 'advanced' | 'simple';
type WorkspaceView = ChannelResponse<'accounts.workspace'>;

interface WorkspaceContextValue {
  readonly mode: WorkspaceMode;
  readonly preferences: WorkspaceView['preferences'] | null;
  readonly pending: boolean;
  readonly shellState: WorkspaceShellState;
  readonly inspectorVisible: boolean;
  setMode(mode: WorkspaceMode): Promise<void>;
  update(patch: Partial<WorkspaceView['preferences']>): Promise<void>;
  openInspector(): void;
  closeInspector(): void;
  toggleInspector(): void;
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
  const [shellState, setShellState] = useState<WorkspaceShellState>('standard');
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const target = document.querySelector<HTMLElement>('.app-workspace');
    if (target === null) return;
    const updateState = (width: number): void => setShellState(shellStateForWidth(width));
    updateState(target.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) updateState(entry.contentRect.width);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (shellState === 'wide') setDrawerOpen(false);
  }, [shellState]);

  const value = useMemo<WorkspaceContextValue>(() => {
    const update = async (patch: Partial<WorkspaceView['preferences']>): Promise<void> => {
      await command.run({ commandId: crypto.randomUUID(), patch });
    };
    return {
      mode: preferences?.workspaceMode ?? 'advanced',
      preferences,
      pending: command.state.kind === 'pending',
      shellState,
      inspectorVisible: shellState === 'wide' ? (preferences?.inspectorOpen ?? false) : drawerOpen,
      setMode: async (mode) => {
        if (mode === (preferences?.workspaceMode ?? 'advanced')) return;
        await update({ workspaceMode: mode });
      },
      update,
      openInspector: () => {
        if (shellState === 'wide') void update({ inspectorOpen: true });
        else setDrawerOpen(true);
      },
      closeInspector: () => {
        if (shellState === 'wide') void update({ inspectorOpen: false });
        else setDrawerOpen(false);
      },
      toggleInspector: () => {
        if (shellState === 'wide') void update({ inspectorOpen: !(preferences?.inspectorOpen ?? false) });
        else setDrawerOpen((open) => !open);
      },
    };
  }, [command, drawerOpen, preferences, shellState]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (value === null) throw new Error('WorkspaceProvider is missing.');
  return value;
}
