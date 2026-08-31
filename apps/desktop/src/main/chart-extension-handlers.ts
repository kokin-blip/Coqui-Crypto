import { sha256Hex, type Clock } from '@coqui/core';
import { ChartExtensionService } from '@coqui/services';
import { readChartWorkspaceCommand, saveChartWorkspaceCommand, type Db } from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';

interface Command { readonly commandId: string }

export function createChartExtensionHandlers(input: {
  readonly profileId: string; readonly database: Db; readonly clock: Clock;
}): ChannelHandlers {
  const service = new ChartExtensionService(input);
  const command = <T>(payload: Command, action: unknown, run: () => T) => {
    const requestHash = sha256Hex(`${input.profileId}:extension:${JSON.stringify(action)}`);
    const prior = readChartWorkspaceCommand(payload.commandId, input.database);
    if (prior !== null) return prior.profileId === input.profileId && prior.requestHash === requestHash
      ? JSON.parse(prior.outcomeJson) as { readonly ok: true; readonly value: T }
      : { ok: false as const, issues: [{ code: 'command_conflict' }] };
    try {
      const outcome = { ok: true as const, value: run() };
      saveChartWorkspaceCommand({ commandId: payload.commandId, profileId: input.profileId,
        requestHash, outcomeJson: JSON.stringify(outcome), recordedAtMs: input.clock.nowMs() }, input.database);
      return outcome;
    } catch {
      return { ok: false as const, issues: [{ code: 'invalid_chart_extension' }] };
    }
  };
  return {
    'chart-extensions.catalog': () => ({ ok: true, value: service.catalog() }),
    'chart-extensions.signer.trust': (payload: Command & { readonly displayName: string; readonly publicKeyBase64: string }) => command(payload, payload, () => ({ outcome: 'trusted' as const, keyId: service.trustSigner(payload.displayName, payload.publicKeyBase64) })),
    'chart-extensions.signer.remove': (payload: Command & { readonly keyId: string }) => command(payload, payload, () => ({ outcome: 'revoked' as const, keyId: payload.keyId, disabledCount: service.revokeSigner(payload.keyId) })),
    'chart-extensions.install': (payload: Command & { readonly packageJson: string }) => command(payload, { ...payload, packageJson: sha256Hex(payload.packageJson) }, () => service.install(payload.packageJson)),
    'chart-extensions.set': (payload: Command & { readonly extensionId: string; readonly enabled: boolean; readonly settings: Record<string, string | number | boolean> }) => command(payload, payload, () => service.set(payload.extensionId, payload.enabled, payload.settings)),
    'chart-extensions.remove': (payload: Command & { readonly extensionId: string }) => command(payload, payload, () => service.remove(payload.extensionId)),
    'chart-extensions.evaluate': async (payload: { readonly extensionId: string; readonly bars: readonly { readonly timeMs: number; readonly close: string }[] }) => {
      try { return { ok: true, value: await service.evaluate(payload.extensionId, payload.bars) }; }
      catch { return { ok: false, issues: [{ code: 'chart_extension_failed' }] }; }
    },
  } as ChannelHandlers;
}
