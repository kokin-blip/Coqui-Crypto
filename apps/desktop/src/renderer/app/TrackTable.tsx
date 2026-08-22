import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatPercent, validationBadge } from '@coqui/ui-kit';

import { useChannel } from '../query/use-channel.js';

type ScoreboardView = ChannelResponse<'research.scoreboard'>;
type Track = ScoreboardView['tracks'][number];

/**
 * The comparable track table (`docs/UI-UX.md` §2.3, wireframe region 3).
 *
 * Every cell that has no value renders an em dash with a screen-reader reason,
 * never a zero and never a borrowed figure. The DSR column is the case that
 * matters: only the selected candidate was tested for significance, so hold and
 * passive show nothing rather than the candidate's number.
 */

const TRACK_LABELS: Readonly<Record<Track['trackId'], string>> = {
  selected: 'trendvol (selected)',
  hold: 'hold',
  passive: 'passive',
};

function Absent({ reason }: { readonly reason: string }): React.JSX.Element {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{reason}</span>
    </>
  );
}

function Percent({ value }: { readonly value: number }): React.JSX.Element {
  const formatted = formatPercent(value);
  if (formatted === null) return <Absent reason="not a finite value" />;
  return (
    <>
      <span aria-hidden="true">{formatted.figure.marker}</span> {formatted.text}
    </>
  );
}

function Row({ track }: { readonly track: Track }): React.JSX.Element {
  const isSelected = track.trackId === 'selected';
  return (
    <tr>
      <th scope="row" className="pr-4 text-left font-normal">
        {isSelected && <span aria-hidden="true">★ </span>}
        {TRACK_LABELS[track.trackId]}
        {isSelected && <span className="sr-only">selected candidate</span>}
      </th>
      <td className="pr-4 text-right tabular-nums">
        <Percent value={track.afterCostReturnPct} />
      </td>
      <td className="pr-4 text-right tabular-nums">
        <Percent value={track.maxDrawdownPct} />
      </td>
      <td className="pr-4 text-right tabular-nums">
        {track.sortino === null ? (
          // An all-positive series has no downside deviation, so Sortino is
          // undefined. Rendering 0.00 would read as "no risk-adjusted return".
          <Absent reason="undefined — no downside deviation in this window" />
        ) : (
          track.sortino.toFixed(2)
        )}
      </td>
      <td className="pr-4 text-right tabular-nums">
        {track.dsr === null ? (
          <Absent reason="not tested for significance — this track was never a candidate" />
        ) : (
          <>
            {track.dsr.toFixed(2)} <span aria-hidden="true">▲ub</span>
          </>
        )}
      </td>
      <td className="text-right tabular-nums">
        {track.trialCount === null ? <Absent reason="no search budget" /> : track.trialCount}
      </td>
    </tr>
  );
}

export function TrackTable({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const scoreboard = useChannel(client, 'research.scoreboard', {});

  if (scoreboard.kind === 'loading') return <p aria-live="polite">Loading tracks…</p>;

  if (scoreboard.kind !== 'ready') {
    const noRun = scoreboard.issues.some((issue) => issue.code === 'no_verified_run');
    return (
      <p role={noRun ? undefined : 'alert'}>
        {noRun
          ? 'No study has been run against this profile yet, so there is nothing to compare.'
          : `Could not load tracks: ${scoreboard.issues.map((issue) => issue.code).join(', ')}`}
      </p>
    );
  }

  const view = scoreboard.value;
  const bound = validationBadge('upper-bound', view.tracks[0]?.trialCount ?? null);

  return (
    <section aria-labelledby="tracks-heading" className="space-y-2">
      <h3 id="tracks-heading" className="font-semibold">
        Comparable tracks
      </h3>

      <table className="w-full text-left">
        <caption className="sr-only">
          After-cost return, drawdown, Sortino, deflated Sharpe and trial count per track
        </caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="pr-4 font-normal opacity-70">TRACK</th>
            <th scope="col" className="pr-4 text-right font-normal opacity-70">AFTER-COST</th>
            <th scope="col" className="pr-4 text-right font-normal opacity-70">MAXDD</th>
            <th scope="col" className="pr-4 text-right font-normal opacity-70">SORTINO</th>
            <th scope="col" className="pr-4 text-right font-normal opacity-70">DSR</th>
            <th scope="col" className="text-right font-normal opacity-70">TRIALS</th>
          </tr>
        </thead>
        <tbody>
          {view.tracks.map((track) => (
            <Row key={track.trackId} track={track} />
          ))}
        </tbody>
      </table>

      {/*
        A footnote, not a tooltip: UI-UX §0 forbids exposing provenance only on
        hover, and the direction of the bound is the substance of the claim.
      */}
      <p className="opacity-80">
        <span aria-hidden="true">▲ub </span>
        {bound.label}
      </p>
      <p className="opacity-80">
        sample {view.sampleDays === null ? 'unavailable' : `${view.sampleDays}d`} · dataset{' '}
        {view.datasetHash.slice(0, 8)}… · code {view.codeRevision.slice(0, 7)} ·{' '}
        {view.adopted ? 'adopted' : 'not adopted'}
      </p>
    </section>
  );
}
