export type WorkstationInterval = '1m' | '5m' | '15m' | '1h' | '6h' | '1d';
export type WorkstationChartStyle = 'candles' | 'line' | 'area' | 'baseline';
export type WorkstationScaleMode = 'linear' | 'percentage' | 'indexed' | 'logarithmic';
export type WorkstationLayout = 'single' | 'horizontal' | 'vertical' | 'grid' | 'dominant';
export type DrawingTool = 'cursor' | 'horizontal' | 'vertical' | 'trend' | 'ray' |
  'rectangle' | 'fibonacci' | 'text' | 'measure';

export interface WorkstationBar {
  readonly productId: string;
  readonly interval: WorkstationInterval;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string | null;
  readonly isComplete: boolean;
}

export interface ChartPoint {
  readonly timeMs: number;
  readonly value: string;
}

export interface ChartDrawing {
  readonly id: string;
  readonly kind: Exclude<DrawingTool, 'cursor'>;
  readonly points: readonly ChartPoint[];
  readonly label: string | null;
}
