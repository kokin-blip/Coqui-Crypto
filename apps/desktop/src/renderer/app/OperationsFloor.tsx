import type { CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';
import { CrewRobot } from './CrewRobot.js';
import { SurfaceState } from './SurfaceState.js';
import { exactUtcTimestamp, formatEvidenceTime, formatLocalTime } from './time-format.js';

const CHARACTERS = {
  host: { name: 'Coqui' },
  market: { name: 'Scout' },
  research: { name: 'Darwin' },
  risk: { name: 'Guard' },
  execution: { name: 'Courier' },
  advisor: { name: 'Advisor' },
} as const;

export function OperationsFloor({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const floor = useChannel(client, 'operations.floor', {});
  return <section className="panel operations-floor" aria-labelledby="operations-floor-heading">
    <div className="panel-heading"><div><h2 id="operations-floor-heading">Operations floor</h2>
      <p>Six bounded read models. Every available state cites persisted evidence.</p></div>
      {floor.kind === 'ready' && <time dateTime={exactUtcTimestamp(floor.value.asOfMs)} title={exactUtcTimestamp(floor.value.asOfMs)}>
        Read {formatLocalTime(floor.value.asOfMs)}</time>}
    </div>
    {floor.kind === 'loading' && <SurfaceState kind="loading" title="Reading persisted operations evidence" compact />}
    {floor.kind !== 'loading' && floor.kind !== 'ready' && <SurfaceState kind="error"
      title="Operations evidence unavailable" detail={floor.issues.map((issue) => issue.code).join(', ')} compact />}
    {floor.kind === 'ready' && <ul className="operations-floor-grid">
      {[...floor.value.subsystems].sort((left, right) => Number(right.state === 'attention') - Number(left.state === 'attention'))
        .map((item) => <li key={item.subsystem} data-state={item.state}>
        <CrewRobot role={item.subsystem} state={item.state}
          {...(item.subsystem === 'research' ? { accessoryVariant: 0 as const } : {})} className="operations-avatar" />
        <header><span className="operations-state" aria-hidden="true" /><strong>{CHARACTERS[item.subsystem].name}</strong>
          <span>{item.state}</span></header>
        <small>{item.title}</small>
        <p>{item.detail}</p>
        <footer><time dateTime={item.evidenceAtMs === null ? undefined : exactUtcTimestamp(item.evidenceAtMs)} title={item.evidenceAtMs === null ? undefined : exactUtcTimestamp(item.evidenceAtMs)}>
          {formatEvidenceTime(item.evidenceAtMs)}</time><span>{item.scope}</span></footer>
        {item.evidenceId !== null && <small title={item.evidenceId}>evidence {item.evidenceId.slice(0, 12)}…</small>}
      </li>)}
    </ul>}
  </section>;
}
