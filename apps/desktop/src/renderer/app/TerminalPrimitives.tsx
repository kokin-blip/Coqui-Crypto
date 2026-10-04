import type { ReactNode } from 'react';
import type { ChannelState } from '../query/use-channel.js';
import { SurfaceState } from './SurfaceState.js';

export function TerminalTabs<T extends string>({ tabs, value, onChange, label, id }: {
  readonly tabs: readonly T[]; readonly value: T; readonly onChange: (value: T) => void;
  readonly label: string; readonly id: string;
}): React.JSX.Element {
  return <div className="terminal-tabs" role="tablist" aria-label={label}>{tabs.map((tab, index) =>
    <button key={tab} id={`${id}-tab-${index}`} role="tab" type="button" aria-selected={value === tab}
      aria-controls={`${id}-panel`} tabIndex={value === tab ? 0 : -1} onClick={() => onChange(tab)}
      onKeyDown={(event) => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); onChange(tabs[next]!);
        document.getElementById(`${id}-tab-${next}`)?.focus();
      }}>{tab}</button>)}</div>;
}

export function ChannelNotice({ state, label }: { readonly state: ChannelState<unknown>; readonly label: string }): React.JSX.Element | null {
  if (state.kind === 'ready') return null;
  return <SurfaceState compact kind={state.kind === 'loading' ? 'loading' : state.kind === 'blocked' ? 'blocked' : 'error'}
    title={`${label} ${state.kind === 'loading' ? 'loading' : state.kind === 'unknown' ? 'outcome unknown' : state.kind === 'blocked' ? 'blocked' : 'unavailable'}`}
    {...(state.kind === 'loading' ? {} : { detail: state.issues.map((issue) => issue.code).join(', ') })} />;
}

export function TerminalMetric({ label, children, tone = '' }: {
  readonly label: string; readonly children: ReactNode; readonly tone?: string;
}): React.JSX.Element {
  return <div className="terminal-metric"><dt>{label}</dt><dd className={tone}>{children}</dd></div>;
}
