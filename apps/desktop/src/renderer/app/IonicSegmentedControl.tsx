export interface SegmentOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
}

export function IonicSegmentedControl<TValue extends string>({
  ariaLabel,
  disabled = false,
  onChange,
  options,
  value,
}: {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly onChange: (value: TValue) => void;
  readonly options: readonly SegmentOption<TValue>[];
  readonly value: TValue;
}): React.JSX.Element {
  return (
    <div className="coqui-segment" role="group" aria-label={ariaLabel} aria-disabled={disabled}>
      {options.map((option) => (
        <button key={option.value} type="button" disabled={disabled} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
