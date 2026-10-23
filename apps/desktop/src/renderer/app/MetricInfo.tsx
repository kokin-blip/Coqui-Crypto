import { useId } from 'react';
import { Info } from 'lucide-react';

export function MetricInfo({ label, children }: { readonly label: string; readonly children: string }): React.JSX.Element {
  const id = useId();
  return <span className="terminal-metric-help">
    <button type="button" popoverTarget={id} aria-label={`About ${label}`}><Info size={13} aria-hidden="true" /></button>
    <span id={id} popover="auto" className="terminal-metric-explanation" role="note">
      <strong>{label}</strong>{children}
    </span>
  </span>;
}
