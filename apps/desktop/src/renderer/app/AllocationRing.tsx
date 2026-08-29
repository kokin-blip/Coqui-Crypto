import { lazy, Suspense } from 'react';

import type { AllocationDatum } from './AllocationRingChart.js';

const AllocationRingChart = lazy(() => import('./AllocationRingChart.js'));

export function AllocationRing(props: {
  readonly data: readonly AllocationDatum[];
  readonly onSelect?: (id: string) => void;
  readonly selectedId?: string | null;
}): React.JSX.Element {
  return <Suspense fallback={<p aria-live="polite">Loading allocation view…</p>}><AllocationRingChart {...props} /></Suspense>;
}
