import { appendResearchTriggerEvent, getResearchTrigger, saveResearchTrigger,
  type Db, type ResearchTriggerRecord } from '@coqui/storage';

export interface ResearchTriggerDecision {
  readonly start: boolean; readonly reasonCode: 'started' | 'debouncing' | 'cooldown' | 'trial_budget_exhausted' | 'definition_unavailable';
  readonly deadlineAt: number | null;
}
export class ResearchTriggerCoordinator {
  constructor(private readonly database: Db) {}
  configure(input: Omit<ResearchTriggerRecord, 'trialsUsed' | 'lastTriggeredAt' | 'pendingSince'>): void {
    if (input.debounceMs < 0 || input.cooldownMs < 0 || input.maxDurationMs <= 0 || input.trialBudget <= 0) {
      throw new RangeError('Invalid research trigger limits.');
    }
    const existing = getResearchTrigger(input.id, this.database);
    saveResearchTrigger({ ...input, trialsUsed: existing?.trialsUsed ?? 0,
      lastTriggeredAt: existing?.lastTriggeredAt ?? null, pendingSince: existing?.pendingSince ?? null }, this.database);
  }
  request(id: string, trials: number, at: number): ResearchTriggerDecision {
    if (!Number.isSafeInteger(trials) || trials < 1) throw new RangeError('Requested trials must be positive.');
    const trigger = getResearchTrigger(id, this.database);
    if (trigger === null) throw new Error('Research trigger not found.');
    if (trigger.trialsUsed + trials > trigger.trialBudget) return this.#blocked(trigger, at, 'trial_budget_exhausted');
    if (trigger.lastTriggeredAt !== null && at - trigger.lastTriggeredAt < trigger.cooldownMs) return this.#blocked(trigger, at, 'cooldown');
    if (trigger.kind === 'event' && trigger.pendingSince === null) {
      saveResearchTrigger({ ...trigger, pendingSince: at, updatedAt: at }, this.database);
      appendResearchTriggerEvent(id, 'scheduled', 'debounce_started', at, '{}', this.database);
      return { start: false, reasonCode: 'debouncing', deadlineAt: null };
    }
    if (trigger.kind === 'event' && at - trigger.pendingSince! < trigger.debounceMs) {
      appendResearchTriggerEvent(id, 'debounced', 'event_coalesced', at, '{}', this.database);
      return { start: false, reasonCode: 'debouncing', deadlineAt: null };
    }
    saveResearchTrigger({ ...trigger, trialsUsed: trigger.trialsUsed + trials,
      lastTriggeredAt: at, pendingSince: null, updatedAt: at }, this.database);
    appendResearchTriggerEvent(id, 'started', 'started', at, JSON.stringify({ trials }), this.database);
    return { start: true, reasonCode: 'started', deadlineAt: at + trigger.maxDurationMs };
  }
  #blocked(trigger: ResearchTriggerRecord, at: number, reasonCode: 'cooldown' | 'trial_budget_exhausted'): ResearchTriggerDecision {
    appendResearchTriggerEvent(trigger.id, 'blocked', reasonCode, at, '{}', this.database);
    return { start: false, reasonCode, deadlineAt: null };
  }
}
