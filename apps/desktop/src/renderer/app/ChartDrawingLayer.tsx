export type DrawingShape =
  | { readonly id: string; readonly kind: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly dashed?: boolean }
  | { readonly id: string; readonly kind: 'rectangle'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly id: string; readonly kind: 'text'; readonly x: number; readonly y: number; readonly text: string }
  | { readonly id: string; readonly kind: 'fibonacci'; readonly x1: number; readonly x2: number; readonly y1: number; readonly y2: number };

const FIBONACCI_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 1] as const;

export function ChartDrawingLayer({ shapes }: {
  readonly shapes: readonly DrawingShape[];
}): React.JSX.Element {
  return <svg className="chart-drawing-layer" aria-hidden="true">
    {shapes.map((shape) => {
      if (shape.kind === 'line') return <line key={shape.id} x1={shape.x1} y1={shape.y1}
        x2={shape.x2} y2={shape.y2} className={shape.dashed === true ? 'drawing-line dashed' : 'drawing-line'} />;
      if (shape.kind === 'rectangle') return <rect key={shape.id} x={shape.x} y={shape.y}
        width={shape.width} height={shape.height} className="drawing-rectangle" />;
      if (shape.kind === 'text') return <g key={shape.id}><circle cx={shape.x} cy={shape.y} r="3" />
        <text x={shape.x + 7} y={shape.y - 7}>{shape.text}</text></g>;
      return <g key={shape.id}>{FIBONACCI_LEVELS.map((level) => {
        const y = shape.y1 + (shape.y2 - shape.y1) * level;
        return <g key={level}><line x1={shape.x1} x2={shape.x2} y1={y} y2={y} className="drawing-line dashed" />
          <text x={Math.min(shape.x1, shape.x2) + 4} y={y - 3}>{Math.round(level * 100)}%</text></g>;
      })}</g>;
    })}
  </svg>;
}
