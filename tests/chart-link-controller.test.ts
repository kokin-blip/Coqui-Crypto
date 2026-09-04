import { describe, expect, it } from 'vitest';

import { ChartLinkController } from '../apps/desktop/src/renderer/app/chart-link-controller.js';

describe('chart link controller', () => {
  it('broadcasts cursor and range changes only inside the selected link group', () => {
    const controller = new ChartLinkController();
    const primary: unknown[] = [];
    const secondary: unknown[] = [];
    const unsubscribe = controller.subscribe('primary', (event) => primary.push(event));
    controller.subscribe('secondary', (event) => secondary.push(event));

    controller.publish('primary', { kind: 'crosshair', sourceId: 'tile-1', timeMs: 10_000 });
    controller.publish('primary', { kind: 'range', sourceId: 'tile-1', range: {
      fromTimeMs: 1_000, toTimeMs: 20_000,
    } });
    expect(primary).toHaveLength(2);
    expect(secondary).toEqual([]);

    unsubscribe();
    controller.publish('primary', { kind: 'crosshair', sourceId: 'tile-2', timeMs: null });
    expect(primary).toHaveLength(2);
  });
});
