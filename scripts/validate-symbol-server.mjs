import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToIL } from '@sharpforge/compiler';
import { readPE } from '@sharpforge/cil';
import { emitPortablePdb, attachPortablePdb, readPortablePdb, portablePdbKey, peSymbolKey } from '@sharpforge/symbols';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tool = process.env.SF_DOTNET_SYMBOL;
assert(tool, 'Set SF_DOTNET_SYMBOL to the pinned dotnet-symbol 8.0.532401 DLL');
const dotnet = process.env.DOTNET_PATH ?? 'dotnet';
const outputIndex = process.argv.indexOf('--output');
const output = resolve(
  outputIndex < 0 ? join(root, 'artifacts/symbol-server/keys.json') : process.argv[outputIndex + 1],
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const toolSha256 = digest(await readFile(tool));
assert.equal(
  toolSha256,
  '3621a828be08f8faa8275a31acdc6dc00c9cf00a8826147618fedc2914fe207d',
  'Reference tool must be the pinned dotnet-symbol 8.0.532401 NuGet DLL',
);
const temporary = await mkdtemp(join(tmpdir(), 'sharpforge-symbol-server-'));
const requested = [];
const server = createServer((request, response) => {
  requested.push(decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1)));
  response.writeHead(404);
  response.end();
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}/`;

async function capture(path, number) {
  requested.length = 0;
  const child = spawn(
    dotnet,
    [
      tool,
      '--modules',
      '--symbols',
      '--diagnostics',
      '--server-path',
      origin,
      '--timeout',
      '0.25',
      '--cache-directory',
      join(temporary, 'cache-' + number),
      '--output',
      join(temporary, 'output-' + number),
      path,
    ],
    {
      env: { ...process.env, DOTNET_ROLL_FORWARD: 'Major', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      log += chunk.toString();
      if (log.length > 1024 * 1024) child.kill();
    });
  const timeout = setTimeout(() => child.kill(), 30000);
  try {
    const [code, signal] = await once(child, 'exit');
    assert.equal(code, 0, `dotnet-symbol failed (${signal}): ${log}`);
    // The tool catches some failures and exits 0; actual HTTP observations are the qualification evidence.
    assert(requested.length, 'dotnet-symbol made no reference requests: ' + log);
    return [...new Set(requested)].filter((key) => {
      const parts = key.split('/');
      return parts.length === 3 && parts[0] === parts[2] && /^[0-9a-f]+$/i.test(parts[1]);
    });
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const compiled = compileToIL('Console.WriteLine(42);', { portablePdb: false });
  assert(compiled.success);
  const emitted = emitPortablePdb(compiled.assembly, {
    sources: [{ uri: 'Fixture.cs', text: 'Console.WriteLine(42);' }],
  });
  const assembly = attachPortablePdb(compiled.assembly, emitted.bytes, { path: 'C:\\build\\Foo.PDB' });
  const header = readPE(assembly, { inspection: true });
  const view = new DataView(assembly.buffer, assembly.byteOffset, assembly.byteLength);
  view.setUint32(header.optionalStart - 16, 0x542d574e, true);
  const pe = readPE(assembly, { inspection: true });
  const pePath = join(temporary, 'Foo.DLL');
  await writeFile(pePath, assembly);
  const requests = await capture(pePath, 1);
  const pdb = readPortablePdb(emitted.bytes);
  const peKey = requests.find((key) => key.endsWith('/foo.dll'));
  const pdbKey = requests.find((key) => key.endsWith('/foo.pdb'));
  assert.equal(peSymbolKey('Foo.DLL', pe), peKey);
  assert.equal(portablePdbKey('C:\\build\\Foo.PDB', pdb.id), pdbKey);
  const cases = [
    {
      kind: 'pe',
      name: 'Foo.DLL',
      timestamp: pe.timestamp,
      sizeOfImage: pe.sizeOfImage,
      key: peKey,
      inputSha256: digest(assembly),
    },
    {
      kind: 'portable-pdb',
      name: 'C:\\build\\Foo.PDB',
      id: [...pdb.id],
      key: pdbKey,
      inputSha256: digest(emitted.bytes),
    },
  ];
  const microsoftBytes = await readFile(join(root, 'tests/fixtures/portable-pdb/Documents.pdb'));
  const microsoft = readPortablePdb(microsoftBytes);
  const unicodeName = 'ΟΣ.PDB';
  const pdbPath = join(temporary, unicodeName);
  await writeFile(pdbPath, microsoftBytes);
  const nativeKeys = await capture(pdbPath, 2);
  assert.equal(nativeKeys.length, 1);
  assert.equal(portablePdbKey(unicodeName, microsoft.id), nativeKeys[0]);
  cases.push({
    kind: 'portable-pdb',
    name: unicodeName,
    id: [...microsoft.id],
    key: nativeKeys[0],
    inputSha256: digest(microsoftBytes),
  });
  const result = {
    reference: {
      name: 'dotnet-symbol',
      version: '8.0.532401',
      toolSha256,
      endpoint: 'isolated loopback HTTP server; no external requests',
    },
    cases,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, cases: cases.length, output }));
} finally {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await rm(temporary, { recursive: true, force: true });
}
