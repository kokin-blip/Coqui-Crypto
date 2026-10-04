import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

export const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export function fixtureZip(entries: Record<string, string>, zip64 = false, compressed = false): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const [name, text] of Object.entries(entries)) {
    const filename = new TextEncoder().encode(name);
    const original = new TextEncoder().encode(text);
    const data = compressed ? deflateRawSync(original) : original;
    const extra = zip64 ? 20 : 0;
    const header = new Uint8Array(30 + filename.length + extra);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, zip64 ? 45 : 20, true);
    view.setUint16(8, compressed ? 8 : 0, true);
    view.setUint32(18, zip64 ? 0xffffffff : data.length, true);
    view.setUint32(22, zip64 ? 0xffffffff : original.length, true);
    view.setUint16(26, filename.length, true); view.setUint16(28, extra, true);
    header.set(filename, 30);
    if (zip64) {
      const offset = 30 + filename.length;
      view.setUint16(offset, 1, true); view.setUint16(offset + 2, 16, true);
      view.setBigUint64(offset + 4, BigInt(original.length), true);
      view.setBigUint64(offset + 12, BigInt(data.length), true);
    }
    chunks.push(header, data);
  }
  const end = new Uint8Array(22);
  new DataView(end.buffer).setUint32(0, 0x06054b50, true);
  chunks.push(end);
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
// Complete single-entry ZIP for Binance's central-directory based parser.
export function binanceZip(name: string, day: number, close = '105.00000000'): Uint8Array {
  const micros = day >= Date.UTC(2025, 0, 1);
  const timestamp = (time: number): string => String(micros ? BigInt(time) * 1000n : BigInt(time));
  const csv = `${[timestamp(day), '100.00000000', '110.00000000', '90.00000000', close,
    '12.50000000', micros ? String(BigInt(day + 86400000) * 1000n - 1n) : String(day + 86400000 - 1),
    '1200.00000000', '42', '6.00000000', '600.00000000', '0'].join(',')}\n`;
  const local = fixtureZip({ [name.replace('.zip', '.csv')]: csv }).slice(0, -22);
  const filename = new TextEncoder().encode(name.replace('.zip', '.csv'));
  const central = new Uint8Array(46 + filename.length);
  const view = new DataView(central.buffer);
  view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true);
  view.setUint32(20, csv.length, true); view.setUint32(24, csv.length, true);
  view.setUint16(28, filename.length, true); central.set(filename, 46);
  const end = new Uint8Array(22); const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, 1, true); endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true); endView.setUint32(16, local.length, true);
  const zip = new Uint8Array(local.length + central.length + end.length);
  zip.set(local); zip.set(central, local.length); zip.set(end, local.length + central.length);
  return zip;
}
