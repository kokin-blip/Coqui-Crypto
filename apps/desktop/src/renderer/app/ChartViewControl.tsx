import { IonicSegmentedControl, type SegmentOption } from './IonicSegmentedControl.js';

export function ChartViewControl<TValue extends string>(props: {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly onChange: (value: TValue) => void;
  readonly options: readonly SegmentOption<TValue>[];
  readonly value: TValue;
}): React.JSX.Element {
  return <IonicSegmentedControl {...props} />;
}
