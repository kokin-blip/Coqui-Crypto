import { describe, expect, it, vi } from 'vitest';

import {
  createCachedSecretStore,
  createMemorySecretStore,
  type SecretStore,
} from '../packages/adapters/src/index.js';
import { FixedClock } from '../packages/core/src/index.js';
import {
  AdvisorConnectionService,
  DEFAULT_ADVISOR_MODEL_POLICY,
} from '../packages/services/src/index.js';
import {
  getAdvisorProfileConfig,
  openDatabase,
} from '../packages/storage/src/index.js';

const API_KEY = 'advisor-key-material-123456789';

describe('advisor connection service', () => {
  it('returns a secret-free immutable disconnected status with an unpersisted default', async () => {
    const database = openDatabase(':memory:');
    const service = new AdvisorConnectionService({
      database,
      clock: new FixedClock(100),
      secretStore: createMemorySecretStore(),
    });

    const result = await service.status('family-a');
    expect(result).toEqual({
      ok: true,
      value: {
        asOfMs: 100,
        profileId: 'family-a',
        provider: 'gemini',
        credentialState: 'disconnected',
        modelPolicyId: DEFAULT_ADVISOR_MODEL_POLICY,
        modelSource: 'default',
        modelUpdatedAtMs: null,
        advisoryOnly: true,
        executionAuthority: false,
      },
    });
    expect(getAdvisorProfileConfig('family-a', database)).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value)).toBe(true);
    database.close();
  });

  it('validates profile and key before reading time, storage, or secret state', async () => {
    const database = openDatabase(':memory:');
    const nowMs = vi.fn(() => 100);
    const secretStore: SecretStore = {
      read: vi.fn(),
      write: vi.fn(),
      remove: vi.fn(),
    };
    const service = new AdvisorConnectionService({ database, clock: { nowMs }, secretStore });

    const result = await service.connect('bad profile', 'short secret with spaces');
    expect(result).toEqual({
      ok: false,
      issues: [
        { path: ['profileId'], code: 'invalid_profile' },
        { path: ['apiKey'], code: 'invalid_api_key' },
      ],
    });
    expect(nowMs).not.toHaveBeenCalled();
    expect(secretStore.read).not.toHaveBeenCalled();
    expect(secretStore.write).not.toHaveBeenCalled();
    expect(secretStore.remove).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('short secret');
    database.close();
  });

  it('scopes credentials and allowlisted model policy by profile without persisting keys', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(200);
    const secretStore = createMemorySecretStore();
    const service = new AdvisorConnectionService({ database, clock, secretStore });

    const connected = await service.connect('family-a', API_KEY);
    expect(connected).toEqual({
      ok: true,
      value: expect.objectContaining({
        profileId: 'family-a', credentialState: 'connected',
        modelPolicyId: 'advisor_balanced_v1', modelSource: 'default',
      }),
    });
    expect(JSON.stringify(connected)).not.toContain(API_KEY);
    expect(await service.status('family-b')).toEqual({
      ok: true,
      value: expect.objectContaining({ credentialState: 'disconnected' }),
    });

    clock.set(250);
    const policy = service.setModelPolicy('family-a', 'advisor_fast_v1');
    expect(policy).toEqual({
      ok: true,
      value: {
        profileId: 'family-a', modelPolicyId: 'advisor_fast_v1',
        modelSource: 'stored', updatedAtMs: 250,
      },
    });
    expect(getAdvisorProfileConfig('family-a', database)).toEqual({
      profileId: 'family-a', modelPolicyId: 'advisor_fast_v1', updatedAt: 250,
    });
    expect(await service.status('family-a')).toEqual({
      ok: true,
      value: expect.objectContaining({
        credentialState: 'connected', modelPolicyId: 'advisor_fast_v1',
        modelSource: 'stored', modelUpdatedAtMs: 250,
      }),
    });

    const schema = database.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'advisor_profile_configs_v1'",
    ).get() as { sql: string };
    expect(schema.sql).not.toContain('api_key');
    expect(JSON.stringify(database.prepare(
      'SELECT * FROM advisor_profile_configs_v1',
    ).all())).not.toContain(API_KEY);

    clock.set(300);
    expect(await service.disconnect('family-a')).toEqual({
      ok: true,
      value: expect.objectContaining({
        asOfMs: 300, credentialState: 'disconnected',
        modelPolicyId: DEFAULT_ADVISOR_MODEL_POLICY, modelSource: 'default',
      }),
    });
    expect(getAdvisorProfileConfig('family-a', database)).toBeNull();
    expect(await secretStore.read('gemini-api-key', 'family-a')).toEqual({
      ok: true, value: null,
    });
    database.close();
  });

  it('rejects free-form model identifiers without time or persistence mutation', () => {
    const database = openDatabase(':memory:');
    const nowMs = vi.fn(() => 400);
    const service = new AdvisorConnectionService({
      database, clock: { nowMs }, secretStore: createMemorySecretStore(),
    });
    const result = service.setModelPolicy(
      'family-a',
      'https://provider.example/model?key=secret' as 'advisor_fast_v1',
    );
    expect(result).toEqual({
      ok: false,
      issues: [{ path: ['modelPolicyId'], code: 'invalid_model_policy' }],
    });
    expect(JSON.stringify(result)).not.toContain('provider.example');
    expect(nowMs).not.toHaveBeenCalled();
    expect(getAdvisorProfileConfig('family-a', database)).toBeNull();
    database.close();
  });

  it('maps secret-backend failures to stable states and codes without diagnostic leakage', async () => {
    const database = openDatabase(':memory:');
    const backendDetail = 'keychain failed with secret-bearing diagnostic';
    const secretStore = createCachedSecretStore({
      async get() { throw new Error(backendDetail); },
      async set() { throw new Error(backendDetail); },
      async delete() { throw new Error(backendDetail); },
    });
    const service = new AdvisorConnectionService({
      database, clock: new FixedClock(500), secretStore,
    });

    const status = await service.status('family-a');
    expect(status).toEqual({
      ok: true,
      value: expect.objectContaining({ credentialState: 'unavailable' }),
    });
    const connect = await service.connect('family-a', API_KEY);
    expect(connect).toEqual({
      ok: false,
      issues: [{ path: ['apiKey'], code: 'secret_store_unavailable' }],
    });
    expect(JSON.stringify([status, connect])).not.toContain(backendDetail);
    expect(JSON.stringify([status, connect])).not.toContain(API_KEY);
    database.close();
  });

  it('keeps the SQLite model-policy allowlist as a second enforcement boundary', () => {
    const database = openDatabase(':memory:');
    expect(() => database.prepare(`
      INSERT INTO advisor_profile_configs_v1 (profile_id, model_policy_id, updated_at)
      VALUES (?, ?, ?)
    `).run('family-a', 'free-form-model', 1)).toThrow();
    database.close();
  });
});
