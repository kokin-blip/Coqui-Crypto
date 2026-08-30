import { Download, Expand, Shrink } from 'lucide-react';
import { useState, type RefObject } from 'react';

export interface ChartObservation { readonly day: string; readonly label: string }

export function ChartFrame({ containerRef, observations, summary, className, onSnapshot, cursorLabel, children }: {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly observations: readonly ChartObservation[];
  readonly summary: string;
  readonly className: string;
  readonly onSnapshot?: () => Promise<void>;
  readonly cursorLabel?: string | null;
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  const [fullscreen, setFullscreen] = useState(false);
  const [index, setIndex] = useState(Math.max(0, observations.length - 1));
  const boundedIndex = Math.min(index, Math.max(0, observations.length - 1));
  const selected = observations[boundedIndex];
  return <figure className={`${className}${fullscreen ? ' chart-is-fullscreen' : ''}`}>
    <div className="chart-frame-toolbar"><span aria-live="polite">{cursorLabel ?? selected?.label ?? 'No observation selected'}</span><div>{onSnapshot !== undefined && <button type="button" aria-label="Save chart as PNG" onClick={() => void onSnapshot()}><Download size={15} /></button>}<button type="button" aria-label={fullscreen ? 'Exit full screen chart' : 'Open full screen chart'} aria-pressed={fullscreen} onClick={() => setFullscreen((value) => !value)}>{fullscreen ? <Shrink size={15} /> : <Expand size={15} />}</button></div></div>
    <div ref={containerRef} className="chart-canvas" role="img" tabIndex={0} aria-label={`${summary} Use Left and Right arrow keys to inspect observations.`} onKeyDown={(event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setIndex((value) => Math.max(0, Math.min(observations.length - 1, value + (event.key === 'ArrowRight' ? 1 : -1))));
    }} />
    {children}
    <figcaption className="sr-only">{summary}</figcaption>
  </figure>;
}
