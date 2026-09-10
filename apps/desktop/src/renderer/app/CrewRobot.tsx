export type CrewRobotRole = 'host' | 'market' | 'research' | 'risk' | 'execution' | 'advisor';
export type CrewRobotState = 'nominal' | 'active' | 'attention' | 'unavailable' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

const ROLE_LABELS: Record<CrewRobotRole, string> = {
  host: 'Coqui host robot',
  market: 'Scout market robot',
  research: 'Darwin research robot',
  risk: 'Guard risk robot',
  execution: 'Courier execution robot',
  advisor: 'Advisor robot',
};

function RoleAccessory({ role, variant = 0 }: { readonly role: CrewRobotRole; readonly variant?: number }): React.JSX.Element {
  if (role === 'host') return <g className="crew-robot-accessory"><path d="M22 25c2-8 9-12 18-12s16 4 18 12" /><path d="M20 25h40" /><path d="M18 36v13M62 36v13M16 42h5M59 42h5" /></g>;
  if (role === 'market') return <g className="crew-robot-accessory crew-robot-goggles"><circle cx="30" cy="41" r="7" /><circle cx="50" cy="41" r="7" /><path d="M37 41h6M17 39h6M57 39h6" /><path d="M27 30 23 23M53 30l4-7" /></g>;
  if (role === 'risk') return <g className="crew-robot-accessory"><path d="M20 25c1-9 9-14 20-14s19 5 20 14" /><path d="M18 25h44" /><path d="M40 12v12" /><path d="m57 51 7 3v7c0 5-3 8-7 10-4-2-7-5-7-10v-7z" /></g>;
  if (role === 'execution') return <g className="crew-robot-accessory"><path d="M21 24c3-8 10-11 19-11 8 0 14 3 18 9" /><path d="M20 24h42" /><path d="M42 15c8 0 14 2 19 7" /><path d="M61 22h7" /></g>;
  if (role === 'advisor') return <g className="crew-robot-accessory crew-robot-glasses"><circle cx="30" cy="41" r="6" /><circle cx="50" cy="41" r="6" /><path d="M36 41h8M18 40h6M56 40h6" /><path d="M62 43v12l-7 4" /></g>;
  if (variant % 3 === 1) return <g className="crew-robot-accessory"><path d="M22 25c1-10 8-15 18-15s17 5 18 15" /><path d="M21 25h38" /><circle cx="40" cy="8" r="3" /></g>;
  if (variant % 3 === 2) return <g className="crew-robot-accessory crew-robot-goggles"><circle cx="30" cy="41" r="7" /><circle cx="50" cy="41" r="7" /><path d="M37 41h6M17 39h6M57 39h6" /></g>;
  return <g className="crew-robot-accessory crew-robot-mortarboard"><path d="m19 20 21-10 21 10-21 10z" /><path d="M27 24v8c8 5 18 5 26 0v-8" /><path d="M61 20v11" /><circle cx="61" cy="34" r="2" /></g>;
}

function stableVariant(identity: string): number {
  let value = 0;
  for (const character of identity) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return value % 3;
}

export function CrewRobot({ role, state, identity = role, accessoryVariant, className = '' }: {
  readonly role: CrewRobotRole;
  readonly state: CrewRobotState;
  readonly identity?: string;
  readonly accessoryVariant?: 0 | 1 | 2;
  readonly className?: string;
}): React.JSX.Element {
  const resolvedVariant = accessoryVariant ?? stableVariant(identity);
  return <span className={`crew-robot ${className}`.trim()} data-role={role} data-state={state}
    title={`${ROLE_LABELS[role]}, ${state}`} aria-hidden="true">
    <svg viewBox="0 0 80 80" aria-hidden="true" focusable="false">
      <g className="crew-robot-antenna"><path d="M40 22V12" /><circle cx="40" cy="9" r="3" /></g>
      <g className="crew-robot-shell"><rect x="16" y="23" width="48" height="38" rx="11" /><rect x="10" y="34" width="6" height="16" rx="3" /><rect x="64" y="34" width="6" height="16" rx="3" /><rect x="28" y="64" width="24" height="7" rx="3.5" /></g>
      <g className="crew-robot-detail"><path d="M22 31h4M54 31h4M24 58h5M51 58h5" /></g>
      <g className="crew-robot-face"><path className="crew-robot-eye" d="M26 41h9M45 41h9" /><path d="M31 52h18" /></g>
      <RoleAccessory role={role} variant={role === 'research' ? resolvedVariant : 0} />
      <g className="crew-robot-state-mark">
        <path className="crew-robot-check" d="m55 57 4 4 8-10" />
        <path className="crew-robot-alert" d="M70 14v8M70 27v1" />
        <g className="crew-robot-sleep"><path d="m67 16 7 0-7 7h7M69 27h5l-5 5h5" /></g>
      </g>
    </svg>
  </span>;
}
