export function ValidationState({ label = 'Not validated' }: { readonly label?: string }): React.JSX.Element {
  return (
    <span className="validation-state" data-status-indicator>
      <i aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
