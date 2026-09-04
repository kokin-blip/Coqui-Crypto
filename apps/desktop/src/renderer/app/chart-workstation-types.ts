export type WorkstationInterval = '1m' | '5m' | '15m' | '1h' | '6h' | '1d';
export type WorkstationChartStyle = 'candles' | 'line' | 'area' | 'baseline';
export type WorkstationScaleMode = 'linear' | 'percentage' | 'indexed' | 'logarithmic';
export type WorkstationLayout = 'single' | 'horizontal' | 'vertical' | 'grid' | 'dominant';
export type DrawingTool = 'cursor' | 'horizontal' | 'vertical' | 'trend' | 'ray' |
  'rectangle' | 'fibonacci' | 'text' | 'measure';

export interface WorkstationIndicators {
  readonly sma20: boolean;
  readonly sma50: boolean;
  readonly ema20: boolean;
  readonly bollinger20: boolean;
  readonly rsi14: boolean;
  readonly macd: boolean;
}

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

export interface ChartTileConfiguration {
  readonly productId: string;
  readonly interval: WorkstationInterval;
  readonly linkGroup: string | null;
  readonly chartStyle: WorkstationChartStyle;
  readonly scaleMode: WorkstationScaleMode;
  readonly indicators: WorkstationIndicators;
  readonly compareProductIds: readonly string[];
}

export interface ChartVisibleRange {
  readonly fromTimeMs: number;
  readonly toTimeMs: number;
}

export interface WorkstationExtensionSeries {
  readonly extensionId: string;
  readonly id: string;
  readonly title: string;
  readonly pane: number;
  readonly color: string;
  readonly points: readonly ChartPoint[];
}

export interface WorkstationExtensionMarker {
  readonly extensionId: string;
  readonly timeMs: number;
  readonly label: string;
  readonly tone: 'neutral' | 'positive' | 'negative' | 'warning';
}

export interface WorkstationComparisonSeries {
  readonly productId: string;
  readonly points: readonly ChartPoint[];
}
