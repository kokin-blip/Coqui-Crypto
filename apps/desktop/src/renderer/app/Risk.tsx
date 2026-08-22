import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';

type RiskView = ChannelResponse<'risk.dashboard'>;
type Rung = RiskView['ladder'][number];

/**
 * The risk ladder, shown but not offered.
 *
 * Every control here is derived from the equity history on each read. Nothing
 * on this screen can change any of it, and that is the point: `CLAUDE.md` §3.5
 * puts guardrails in code, and P8's exit criterion is that the gate cannot be
 * edited or overridden from the UI. There is no write channel behind this
 * screen, which is a stronger guarantee than a disabled control.
 */

const STAGE_LABEL: Record<Rung['stage'], string> = {
  normal: 'NORMAL',
  caution: 'CAUTION',
  defense: 'DEFENSE',
  hard_stop: 'HARD STOP',
};

function percent(value: number | null, digits = 1): string {
  return value === null ? '—' : `${value.toFixed(digits)}%`;
}

function Rung({ rung }: { readonly rung: Rung }): React.JSX.Element {
  return (
    <li className={rung.active ? 'border-l-2 pl-3 font-semibold' : 'pl-3 opacity-70'}>
      <span aria-hidden="true">{rung.active ? '▶ ' : '  '}</span>
      {STAGE_LABEL[rung.stage]}
      <span className="ml-3 font-normal">
        sizing ×{rung.exposureScale}
        {rung.active && <span className="sr-only"> — current stage</span>}
      </span>
      <p className="font-normal opacity-70">{rung.entryCondition}</p>
    </li>
  );
}

export function Risk({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const risk = useChannel(client, 'risk.dashboard', {});

  if (risk.kind === 'loading') return <p aria-live="polite">Loading risk controls…</p>;

  if (risk.kind !== 'ready') {
    return (
      <p role="alert">
        Could not load risk controls: {risk.issues.map((issue) => issue.code).join(', ')}
      </p>
    );
  }

  const view = risk.value;

  return (
    <section aria-labelledby="risk-heading" className="space-y-2">
      <h2 id="risk-heading" className="font-semibold">
        Risk controls
        <span className="ml-3 font-normal opacity-70">
          stage {STAGE_LABEL[view.stage]} · sizing ×{view.exposureScale}
        </span>
      </h2>

      {view.insufficientHistory && (
        // Said outright. A drawdown computed over three observations looks
        // exactly like a measurement, and reads as one.
        <p role="note" className="border-l-2 pl-3">
          <span aria-hidden="true">⚠ </span>
          {view.sampleCount} equity observation{view.sampleCount === 1 ? '' : 's'} — too few for
          these figures to describe anything yet. The ladder still applies; the numbers do not
          mean much.
        </p>
      )}

      {view.blockReason !== null && (
        <p role="alert" className="border-l-2 pl-3">
          <span aria-hidden="true">■ </span>
          Trading halted: {view.blockReason}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 tabular-nums md:grid-cols-3">
        <div>
          <dt className="opacity-70">drawdown</dt>
          <dd>{percent(view.drawdownPct)}</dd>
        </div>
        <div>
          <dt className="opacity-70">expected shortfall</dt>
          <dd>{percent(view.expectedShortfallPct)}</dd>
        </div>
        <div>
          <dt className="opacity-70">realised vol</dt>
          <dd>{percent(view.realizedVolatilityPct)}</dd>
        </div>
        <div>
          <dt className="opacity-70">forecast vol</dt>
          <dd>{percent(view.forecastVolatilityPct)}</dd>
        </div>
        <div>
          <dt className="opacity-70">max gross exposure</dt>
          <dd>{percent(view.maxGrossExposurePct, 0)}</dd>
        </div>
        <div>
          <dt className="opacity-70">max trades per run</dt>
          <dd>{view.maxTradeCount}</dd>
        </div>
        <div>
          {/* Distinct from price-feed staleness, which this screen cannot
              observe and therefore does not claim. */}
          <dt className="opacity-70">equity history age</dt>
          <dd>
            {view.snapshotAgeMs === null
              ? 'no snapshots'
              : `${Math.floor(view.snapshotAgeMs / 86_400_000)}d`}
          </dd>
        </div>
      </dl>

      <ul className="space-y-1">
        {view.ladder.map((rung) => (
          <Rung key={rung.stage} rung={rung} />
        ))}
      </ul>

      {view.warnings.length > 0 && (
        <ul className="opacity-70">
          {view.warnings.map((warning) => (
            <li key={warning}>
              <span aria-hidden="true">· </span>
              {warning}
            </li>
          ))}
        </ul>
      )}

      <p className="opacity-70">
        These limits are enforced in code before any order is sized. Nothing on this screen can
        raise or disable them.
      </p>
    </section>
  );
}
