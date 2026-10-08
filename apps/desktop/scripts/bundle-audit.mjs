import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const directory = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist/renderer/assets');
const chunks = readdirSync(directory).filter(file => /\.(js|css)$/.test(file)).map(file => {
  const data = readFileSync(join(directory, file));
  const map = join(directory, `${file}.map`);
  const sources = existsSync(map) ? JSON.parse(readFileSync(map)).sources : [];
  return { file, bytes: data.length, gzip: gzipSync(data).length, sources };
}).sort((a, b) => b.bytes - a.bytes);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(chunks, null, 2));
console.log(JSON.stringify(chunks.map(({ file, bytes, gzip }) => ({ file, bytes, gzip })), null, 2));
