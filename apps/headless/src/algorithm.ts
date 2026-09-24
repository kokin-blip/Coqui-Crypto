#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { createAlgorithmReport, parseAlgorithmSnapshot } from './algorithm-report.js';

const HELP = `Usage:
  coqui-algorithm explain --input=path/to/snapshot.json
  cat snapshot.json | coqui-algorithm explain

Runs the canonical TrendVol strategy offline and prints its reasoning. The
executable is deterministic, paper-only, network-inert, and does not write to
the database.

Input shape:
{
  "baseTargets": [{ "assetId": "coinbase|spot|BTC-USD", "weight": 0.5 }],
  "closesById": { "coinbase|spot|BTC-USD": [100, 101, 102] },
  "mixCloses": [100, 101, 102],
  "exposureScale": 1
}`;

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function inputText(): Promise<string> {
  const path = option('input');
  if (path !== undefined) return readFile(path, 'utf8');
  if (process.stdin.isTTY) throw new Error('missing_input');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const command = args[0];
  if (command === undefined || command === 'help' || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (command !== 'explain') throw new Error('unknown_command');
  const report = createAlgorithmReport(parseAlgorithmSnapshot(JSON.parse(await inputText()) as unknown));
  process.stdout.write(`${report.trace.join('\n')}\n\n${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Algorithm command failed: ${error instanceof Error ? error.message : 'unknown_error'}\n`);
  process.exitCode = 1;
});
