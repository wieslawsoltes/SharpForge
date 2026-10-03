import { openZip, writeZipTo } from '../src/index.js';

const parts = [];
async function* source() {
  for (let index = 0; index < 1024; index++) yield new TextEncoder().encode('A streamed record ' + index + '\n');
}
const result = await writeZipTo([{ path: 'records.txt', source: source() }], new WritableStream({
  write(bytes) { parts.push(bytes); }
}), { compression: 'deflate', preserveMetadata: false });
const archive = await openZip(new Blob(parts));
try {
  const text = await new Response(archive.stream('records.txt')).text();
  console.log({ ...result, lines: text.trimEnd().split('\n').length });
} finally { archive.close(); }
