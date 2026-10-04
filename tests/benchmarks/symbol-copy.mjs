import { cpus, platform, arch } from 'node:os';
import { compileToIL } from '@sharpforge/compiler';
import { createSymbolServer, SourceStatus } from '@sharpforge/symbols';

if (!globalThis.gc) throw Error('Run with --expose-gc to isolate each assembly-copy sample');
const compiled = compileToIL('Console.WriteLine(42);');
if (!compiled.success) throw Error('Could not create the lookup fixture');
const cases = [];
for (const inputBytes of [1024 * 1024, 16 * 1024 * 1024, 64 * 1024 * 1024]) {
  const assembly = new Uint8Array(inputBytes);
  assembly.set(compiled.assembly);
  const elapsed = [];
  const allocated = [];
  let baseline = 0;
  let atPermission = 0;
  const client = createSymbolServer({
    serverUrl: 'https://symbols.example',
    allowedOrigins: ['https://symbols.example'],
    requestPermission() {
      atPermission = process.memoryUsage().arrayBuffers - baseline;
      return false;
    },
    fetch() {
      throw Error('The allocation benchmark must not fetch');
    },
  });
  for (let iteration = -2; iteration < 15; iteration++) {
    globalThis.gc();
    baseline = process.memoryUsage().arrayBuffers;
    const start = performance.now();
    const result = await client.lookupForAssembly(assembly);
    const duration = performance.now() - start;
    if (result.status !== SourceStatus.denied) throw Error('Expected denied lookup at permission boundary');
    if (iteration >= 0) {
      elapsed.push(duration);
      allocated.push(atPermission);
    }
  }
  client.dispose();
  elapsed.sort((left, right) => left - right);
  allocated.sort((left, right) => left - right);
  cases.push({
    inputBytes,
    medianMs: elapsed[7],
    p95Ms: elapsed[14],
    medianArrayBufferBytes: allocated[7],
    p95ArrayBufferBytes: allocated[14],
  });
}
console.log(
  JSON.stringify(
    {
      revision: process.env.SF_BENCH_REVISION ?? null,
      node: process.version,
      host: `${platform()} ${arch()} ${cpus()[0].model}`,
      samples: 15,
      measurement:
        'ArrayBuffer delta at permission boundary; permission denied; no download, PDB verification or RSS claim',
      cases,
    },
    null,
    2,
  ),
);
