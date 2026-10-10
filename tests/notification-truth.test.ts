import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const channels = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('../apps/desktop/src/renderer/query/use-channel.js', () => ({ useChannel: (_: unknown, name: string) => channels[name] }));
const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const react = requireDesktop('react'), server = requireDesktop('react-dom/server');
// @ts-expect-error TS6142: renderer JSX is compiled by Vitest.
const { NotificationCenter } = await import('../apps/desktop/src/renderer/app/StatusRail.js');
describe('notification source availability', () => {
  it.each(['loading', 'failed', 'blocked', 'unknown'])('never claims empty when alerts are %s', kind => {
    channels['alerts.view'] = { kind, issues: [{ code: 'source_unavailable' }] };
    channels['activity.feed'] = { kind: 'ready', value: { events: [] } };
    const html = server.renderToStaticMarkup(react.createElement(NotificationCenter, { client: {} }));
    expect(html).not.toContain('No unread or actionable');
    expect(html).toContain('Alerts');
  });
  it('labels successful empty sources as a bounded recent preview', () => {
    channels['alerts.view'] = { kind: 'ready', value: { alerts: [] } };
    channels['activity.feed'] = { kind: 'ready', value: { events: [] } };
    expect(server.renderToStaticMarkup(react.createElement(NotificationCenter, { client: {} }))).toContain('No unread or actionable evidence in the recent preview');
  });
});
