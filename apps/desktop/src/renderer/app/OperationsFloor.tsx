import type { CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';
import { SurfaceState } from './SurfaceState.js';

function evidenceTime(at: number | null): string {
  return at === null ? 'No persisted observation' : new Date(at).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

export function OperationsFloor({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const floor = useChannel(client, 'operations.floor', {});
  return <section className="panel operations-floor" aria-labelledby="operations-floor-heading">
    <div className="panel-heading"><div><h2 id="operations-floor-heading">Operations floor</h2>
      <p>Six bounded read models. Every available state cites persisted evidence.</p></div>
      {floor.kind === 'ready' && <time dateTime={new Date(floor.value.asOfMs).toISOString()}>
        Read {new Date(floor.value.asOfMs).toISOString().slice(11, 19)}Z</time>}
    </div>
    {floor.kind === 'loading' && <SurfaceState kind="loading" title="Reading persisted operations evidence" compact />}
    {floor.kind !== 'loading' && floor.kind !== 'ready' && <SurfaceState kind="error"
      title="Operations evidence unavailable" detail={floor.issues.map((issue) => issue.code).join(', ')} compact />}
    {floor.kind === 'ready' && <ul className="operations-floor-grid">
      {floor.value.subsystems.map((item) => <li key={item.subsystem} data-state={item.state}>
        <header><span className="operations-state" aria-hidden="true" /><strong>{item.title}</strong>
          <span>{item.state}</span></header>
        <p>{item.detail}</p>
        <footer><time dateTime={item.evidenceAtMs === null ? undefined : new Date(item.evidenceAtMs).toISOString()}>
          {evidenceTime(item.evidenceAtMs)}</time><span>{item.scope}</span></footer>
        {item.evidenceId !== null && <small title={item.evidenceId}>evidence {item.evidenceId.slice(0, 12)}…</small>}
      </li>)}
    </ul>}
  </section>;
}
