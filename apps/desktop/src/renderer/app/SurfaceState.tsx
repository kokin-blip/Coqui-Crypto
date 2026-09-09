import { AlertTriangle, Ban, CircleCheck, LoaderCircle } from 'lucide-react';

export type SurfaceStateKind = 'loading' | 'empty' | 'error' | 'blocked' | 'success';

const ICONS = {
  loading: LoaderCircle,
  empty: Ban,
  error: AlertTriangle,
  blocked: Ban,
  success: CircleCheck,
} as const;

/** A consistent, compact state treatment for data-bearing renderer surfaces. */
export function SurfaceState({
  kind,
  title,
  detail,
  compact = false,
  action,
}: {
  readonly kind: SurfaceStateKind;
  readonly title: string;
  readonly detail?: string;
  readonly compact?: boolean;
  readonly action?: { readonly label: string; readonly href: string };
}): React.JSX.Element {
  const Icon = ICONS[kind];
  const role = kind === 'error' || kind === 'blocked' ? 'alert' : 'status';
  return (
    <div
      className={`surface-state surface-state-${kind}${compact ? ' surface-state-compact' : ''}`}
      role={role}
      aria-live={kind === 'loading' ? 'polite' : undefined}
    >
      <Icon aria-hidden="true" size={17} className={kind === 'loading' ? 'surface-state-spinner' : undefined} />
      <span><strong>{title}</strong>{detail !== undefined && <small>{detail}</small>}{action !== undefined && <a className="surface-state-action" href={action.href}>{action.label}</a>}</span>
    </div>
  );
}
