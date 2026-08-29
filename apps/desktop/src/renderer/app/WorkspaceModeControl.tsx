import { IonicSegmentedControl } from './IonicSegmentedControl.js';
import { useWorkspace, type WorkspaceMode } from './WorkspaceContext.js';

const MODES = [
  { value: 'advanced', label: 'Advanced' },
  { value: 'simple', label: 'Simple' },
] as const;

export function WorkspaceModeControl(): React.JSX.Element {
  const workspace = useWorkspace();
  return (
    <IonicSegmentedControl<WorkspaceMode>
      ariaLabel="Workspace mode"
      disabled={workspace.pending}
      onChange={(mode) => void workspace.setMode(mode)}
      options={MODES}
      value={workspace.mode}
    />
  );
}
