import type { ParallelPaperEvent } from '@coqui/storage';

/** Retired plans remain in history; their unattempted intents cannot execute. */
export function activeParallelEvents(events: readonly ParallelPaperEvent[]): readonly ParallelPaperEvent[] {
  const retired = events.filter((event) => event.kind === 'plan_superseded');
  const planIds = new Set(retired.map((event) => event.detail['planId']));
  const clientIds = new Set(retired.flatMap((event) => event.detail['clientOrderIds'] as string[]));
  return events.filter((event) => !planIds.has(event.id) &&
    !(event.kind === 'external_intent' && clientIds.has(String(event.detail['clientOrderId']))));
}

/** A new pass rebuilds only orders which have never been submitted. */
export function supersedeUnsubmittedParallelPlans(events: readonly ParallelPaperEvent[],
  append: (kind: string, key: string, detail: Record<string, unknown>) => void): void {
  const attempts = new Set(events.filter((event) => event.kind === 'submit_attempt').map((event) => event.detail['clientOrderId']));
  for (const plan of activeParallelEvents(events).filter((event) => ['sell_plan', 'buy_plan', 'intraday_plan'].includes(event.kind))) {
    if (!Array.isArray(plan.detail['orders'])) continue;
    const clientOrderIds = (plan.detail['orders'] as { clientOrderId: string }[])
      .map((order) => order.clientOrderId).filter((id) => !attempts.has(id));
    if (clientOrderIds.length === 0) continue;
    append('plan_superseded', `superseded:${plan.id}`, { planId: plan.id, clientOrderIds,
      day: plan.detail['day'] ?? null, slot: plan.detail['slot'] ?? null,
      stage: plan.detail['stage'] ?? plan.kind.replace('_plan', ''), reason: 'fresh_pass_required' });
  }
}
