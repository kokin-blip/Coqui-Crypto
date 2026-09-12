import type { Clock } from '@coqui/core';
import type { PersonIdentityStore, PersonIdentityV1 } from '@coqui/storage';

export type PersonIdentityIssueCode = 'invalid_display_name' | 'identity_unavailable' | 'identity_corrupt' | 'identity_conflict';
export type PersonIdentityResult<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly issues: readonly { readonly path: readonly string[]; readonly code: PersonIdentityIssueCode }[] };

function failure(code: PersonIdentityIssueCode, path: readonly string[] = []): PersonIdentityResult<never> {
  return { ok: false, issues: [{ path, code }] };
}

function now(clock: Clock): number {
  const value = clock.nowMs();
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid onboarding clock.');
  return value;
}

function freshIdentity(atMs: number): PersonIdentityV1 {
  return Object.freeze({ schemaVersion: 1, displayName: null, introState: 'not_started',
    createdAtMs: atMs, updatedAtMs: atMs, skippedAtMs: null, completedAtMs: null });
}

function canonicalName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().replace(/\s+/gu, ' ');
  if (value.length < 1 || value.length > 40) return null;
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ? null : value;
}

export class PersonIdentityService {
  constructor(private readonly store: PersonIdentityStore, private readonly clock: Clock) {}

  status(): PersonIdentityResult<PersonIdentityV1> {
    const loaded = this.store.read();
    if (!loaded.ok) return loaded.code === 'corrupt' ? { ok: true, value: freshIdentity(now(this.clock)) }
      : failure('identity_unavailable');
    if (loaded.value !== null) return { ok: true, value: loaded.value.value };
    return { ok: true, value: freshIdentity(now(this.clock)) };
  }

  setDisplayName(displayName: unknown): PersonIdentityResult<PersonIdentityV1> {
    const name = canonicalName(displayName);
    if (name === null) return failure('invalid_display_name', ['displayName']);
    return this.#replace((prior, atMs) => ({ ...prior, displayName: name,
      introState: prior.introState === 'not_started' ? 'in_progress' : prior.introState,
      updatedAtMs: atMs }));
  }

  skip(): PersonIdentityResult<PersonIdentityV1> {
    return this.#replace((prior, atMs) => ({ ...prior, introState: 'skipped',
      skippedAtMs: atMs, updatedAtMs: atMs }));
  }

  restart(): PersonIdentityResult<PersonIdentityV1> {
    return this.#replace((prior, atMs) => ({ ...prior, introState: 'in_progress',
      skippedAtMs: null, updatedAtMs: atMs }));
  }

  markPortfolioReady(): PersonIdentityResult<PersonIdentityV1> {
    return this.#replace((prior, atMs) => prior.introState === 'portfolio_ready' ? prior : ({ ...prior,
      introState: 'portfolio_ready', completedAtMs: atMs, skippedAtMs: null, updatedAtMs: atMs }));
  }

  #replace(update: (prior: PersonIdentityV1, atMs: number) => PersonIdentityV1): PersonIdentityResult<PersonIdentityV1> {
    const loaded = this.store.read();
    if (!loaded.ok && loaded.code !== 'corrupt') return failure('identity_unavailable');
    const atMs = now(this.clock);
    const prior = loaded.ok ? loaded.value?.value ?? freshIdentity(atMs) : freshIdentity(atMs);
    const next = Object.freeze(update(prior, atMs));
    const saved = this.store.replace(loaded.ok ? loaded.value?.revision ?? null : null, next);
    if (!saved.ok) return failure(saved.code === 'conflict' ? 'identity_conflict' : 'identity_unavailable');
    return { ok: true, value: next };
  }
}
