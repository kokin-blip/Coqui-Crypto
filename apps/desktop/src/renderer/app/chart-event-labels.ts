import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { ChartEvidenceGroup } from './chart-evidence-groups.js';
import type { WorkstationBar, WorkstationExtensionMarker } from './chart-workstation-types.js';

type Group = ChartEvidenceGroup<WorkstationExtensionMarker>;
const PRIORITY = { neutral: 0, positive: 1, warning: 2, negative: 3 } as const;
type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];

function label(group: Group): { badge: string; detail: string } {
  if (group.items.length > 1) return { badge: `${group.items.length} events`, detail: 'Recorded evidence' };
  const item = group.items[0]!;
  if (item.extensionId.startsWith('decision:')) return {
    badge: item.label.startsWith('Global') ? 'Global decision' : 'Decision',
    detail: item.label.replace(/^(Global )?Decision\s*/i, ''),
  };
  if (item.extensionId.startsWith('position:')) return { badge: 'Position', detail: item.label.replace(/^Position · /, '') };
  if (item.extensionId.startsWith('proposal:')) {
    const [badge, ...details] = item.label.split(' · ');
    return { badge: badge!, detail: details.join(' · ') };
  }
  if (item.extensionId.startsWith('fill:')) return {
    badge: item.label.startsWith('Buy ') ? 'Buy fill' : item.label.startsWith('Sell ') ? 'Sell fill' : 'Fill',
    detail: item.label.replace(/^(Buy|Sell|Fill)\s*/, ''),
  };
  return { badge: item.extensionId.startsWith('event:') ? 'Market event' : 'Event', detail: item.label.replace(/^Event\s*/, '') };
}

function fitText(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;
  let value = text;
  while (value.length > 0 && context.measureText(`${value}…`).width > width) value = value.slice(0, -1);
  return `${value}…`;
}

/** Native chart annotation: scales with the viewport and is included in chart exports. */
export class ChartEventLabels implements ISeriesPrimitive<Time> {
  private attachedTo: SeriesAttachedParameter<Time> | null = null;
  private groups: readonly Group[] = [];
  private bars = new Map<number, WorkstationBar>();
  private readonly views: readonly IPrimitivePaneView[];
  private readonly themeObserver: MutationObserver;

  constructor(private readonly container: HTMLElement) {
    const renderer: IPrimitivePaneRenderer = { draw: target => this.draw(target) };
    this.views = [{ zOrder: () => 'top', renderer: () => renderer }];
    this.themeObserver = new MutationObserver(() => this.attachedTo?.requestUpdate());
  }

  attached(parameter: SeriesAttachedParameter<Time>): void {
    this.attachedTo = parameter;
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  detached(): void {
    this.themeObserver.disconnect();
    this.attachedTo = null;
  }

  paneViews(): readonly IPrimitivePaneView[] { return this.views; }

  update(groups: readonly Group[], bars: readonly WorkstationBar[]): void {
    // Price-bearing orders are distinct even when several share a candle.
    this.groups = groups.flatMap(group => {
      const context = group.items.filter(item => item.priceUsd === undefined);
      return [...(context.length > 0 ? [{ ...group, items: context, tone: context.reduce<Group['tone']>((tone, item) => (PRIORITY[item.tone] > PRIORITY[tone] ? item.tone : tone), 'neutral') }] : []),
        ...group.items.filter(item => item.priceUsd !== undefined).map(item => ({ ...group, tone: item.tone, items: [item] }))];
    });
    this.bars = new Map(bars.map(bar => [bar.startTimeMs, bar]));
    this.attachedTo?.requestUpdate();
  }

  private draw(target: Target): void {
    const attached = this.attachedTo;
    if (attached === null || this.groups.length === 0) return;
    const style = getComputedStyle(this.container);
    const color = (name: string): string => style.getPropertyValue(name).trim();
    const tones = { positive: color('--coqui-positive'), negative: color('--coqui-negative'), warning: color('--coqui-warning'), neutral: color('--coqui-text-muted') };
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const placed: Array<{ x: number; y: number; width: number }> = [];
      context.save();
      context.font = '500 12px "IBM Plex Sans Variable", "IBM Plex Sans", sans-serif';
      context.textBaseline = 'middle';
      for (const group of this.groups) {
        const bar = this.bars.get(group.timeMs);
        if (bar === undefined) continue;
        const anchorX = attached.chart.timeScale().timeToCoordinate(Math.floor(group.timeMs / 1_000) as Time);
        const anchorY = attached.series.priceToCoordinate(Number(group.items[0]?.priceUsd ?? (group.tone === 'positive' ? bar.low : bar.high)));
        if (anchorX === null || anchorY === null || anchorX < 0 || anchorX > mediaSize.width || anchorY < 0 || anchorY > mediaSize.height) continue;
        const text = label(group);
        const badgeWidth = context.measureText(text.badge).width + 20;
        const width = Math.min(mediaSize.width - 12, badgeWidth + Math.min(220, context.measureText(text.detail).width + 24));
        if (width <= badgeWidth + 24) continue;
        const x = Math.max(6, Math.min(mediaSize.width - width - 6, anchorX - badgeWidth / 2));
        const preferredY = anchorY + (group.tone === 'positive' ? 14 : -42);
        const clampY = (value: number): number => Math.max(6, Math.min(mediaSize.height - 34, value));
        const candidates = [preferredY];
        for (let lane = 1; lane <= Math.ceil(mediaSize.height / 34); lane++) candidates.push(preferredY - lane * 34, preferredY + lane * 34);
        // Pick the nearest free lane; never accumulate offsets that send a label across the plot.
        const y = candidates.map(clampY).find(candidate => !placed.some(p =>
          x < p.x + p.width + 6 && x + width + 6 > p.x && Math.abs(candidate - p.y) < 34)) ?? clampY(preferredY);
        placed.push({ x, y, width });
        const accent = tones[group.tone];
        context.strokeStyle = accent;
        context.lineWidth = 1;
        context.setLineDash([3, 3]);
        context.beginPath(); context.moveTo(anchorX, anchorY); context.lineTo(anchorX, y < anchorY ? y + 28 : y); context.stroke();
        context.setLineDash([]);
        context.beginPath(); context.moveTo(anchorX - 3, anchorY); context.lineTo(anchorX + 3, anchorY); context.moveTo(anchorX, anchorY - 3); context.lineTo(anchorX, anchorY + 3); context.stroke();
        context.fillStyle = color('--coqui-surface-1');
        context.beginPath(); context.roundRect(x, y, width, 28, 4); context.fill(); context.stroke();
        context.save();
        context.clip();
        context.fillStyle = color('--coqui-surface-2'); context.fillRect(x, y, badgeWidth, 28);
        context.restore();
        context.beginPath(); context.roundRect(x, y, width, 28, 4); context.stroke();
        context.beginPath(); context.moveTo(x + badgeWidth, y); context.lineTo(x + badgeWidth, y + 28); context.stroke();
        context.fillStyle = accent; context.fillText(text.badge, x + 10, y + 14);
        context.fillStyle = color('--coqui-text'); context.fillText(fitText(context, text.detail, width - badgeWidth - 20), x + badgeWidth + 10, y + 14);
      }
      context.restore();
    });
  }
}
