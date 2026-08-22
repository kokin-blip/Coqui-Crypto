/**
 * A panel whose backing row is re-phased to a later phase.
 *
 * `docs/UI-UX.md` §0 forbids stock filler and generic copy standing in for an
 * explanation. A stubbed panel showing invented numbers would be worse than
 * absence — it would teach the user to trust a figure with nothing behind it.
 * So a deferred capability is *visibly* absent and says which phase owns it.
 */
export function DeferredPanel({
  title,
  phase,
  reason,
}: {
  readonly title: string;
  readonly phase: string;
  readonly reason: string;
}): React.JSX.Element {
  return (
    <section aria-labelledby={`deferred-${phase}-${title}`} className="border-l-2 pl-3 opacity-70">
      <h3 id={`deferred-${phase}-${title}`} className="font-semibold">
        {title} — not built yet
      </h3>
      <p>
        Deferred to {phase}. {reason}
      </p>
    </section>
  );
}
