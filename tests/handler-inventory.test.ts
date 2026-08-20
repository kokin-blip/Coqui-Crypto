import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const serviceNames = [
  'accounts',
  'advisor',
  'alerts',
  'ingest',
  'market-data',
  'paper',
  'portfolio',
  'research',
  'risk',
  'scheduler',
] as const;

type ServiceName = (typeof serviceNames)[number];

const expectedCounts: Readonly<Record<ServiceName, number>> = Object.freeze({
  accounts: 26,
  advisor: 9,
  alerts: 8,
  ingest: 5,
  'market-data': 15,
  paper: 22,
  portfolio: 23,
  research: 26,
  risk: 4,
  scheduler: 2,
});

function readInventory(): string[] {
  return readFileSync(join(process.cwd(), 'docs/handler-inventory.md'), 'utf8').split(/\r?\n/u);
}

describe('predecessor IPC handler inventory', () => {
  it('catalogues 140 unique handlers in source order and assigns every one to a service', () => {
    const serviceSet = new Set<string>(serviceNames);
    const rows = readInventory().flatMap((line) => {
      const match = /^\| (\d{4}) \| `([A-Z0-9_]+)` \| `([a-z-]+)` \|/u.exec(line);
      if (!match) return [];
      return [{ line: Number(match[1]), channel: match[2]!, service: match[3]! }];
    });

    expect(rows).toHaveLength(140);
    expect(new Set(rows.map(({ channel }) => channel))).toHaveLength(140);
    expect(rows[0]).toMatchObject({ line: 9583, channel: 'MARKET_PRICES' });
    expect(rows.at(-1)).toMatchObject({ line: 9850, channel: 'PROFILE_AUTOMATION_STATUS' });
    expect(rows.every(({ service }) => serviceSet.has(service))).toBe(true);
    expect(rows.slice(1).every((row, index) => row.line > rows[index]!.line)).toBe(true);

    const actualCounts = Object.fromEntries(
      serviceNames.map((service) => [
        service,
        rows.filter((row) => row.service === service).length,
      ]),
    );
    expect(actualCounts).toEqual(expectedCounts);
  });

  it('keeps the documented service summary reconciled with the catalogue', () => {
    const summary = Object.fromEntries(
      readInventory().flatMap((line) => {
        const match = /^\| `([a-z-]+)` \| (\d+) \|$/u.exec(line);
        return match ? [[match[1]!, Number(match[2])]] : [];
      }),
    );

    expect(summary).toEqual(expectedCounts);
    expect(Object.values(summary).reduce((total, count) => total + count, 0)).toBe(140);
  });
});
