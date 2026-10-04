import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMetadata } from '@sharpforge/cil';
import { emitPortablePdbDelta, PortablePdbGenerations, readPortablePdbDelta } from '@sharpforge/symbols';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dotnet = process.env.DOTNET_PATH ?? 'dotnet';
const temporary = await mkdtemp(join(tmpdir(), 'sharpforge-pdb-delta-writer-'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (args) => {
  const result = spawnSync(dotnet, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } });
  if (result.error || result.status !== 0) throw Error(result.error?.message ?? result.stdout + result.stderr);
  return result.stdout.trim();
};

try {
  const fixture = join(root, 'tests/fixtures/portable-pdb-generations');
  const original = JSON.parse(await readFile(join(fixture, 'reference.json'), 'utf8'));
  const generation = original.generations[1];
  const method = generation.symbols.methods[0];
  const history = new PortablePdbGenerations(await readFile(join(fixture, 'baseline.pdb')));
  const deltaMetadata = readMetadata(await readFile(join(fixture, 'delta1.dmeta')));
  const deltaRowCounts = Object.fromEntries(Object.entries(deltaMetadata.counts).filter(([table]) => +table < 48 && +table !== 30 && +table !== 31));
  const custom = [{ parent: method.token, kind: '00112233-4455-6677-8899-aabbccddeeff', bytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) }];
  const debug = {
    sources: generation.symbols.documents.map(({ name }) => ({ uri: name, text: 'Native delta writer fixture' })),
    methods: [{ token: method.token, codeSize: Math.max(...method.scopes.map((scope) => scope.end)),
      localSignature: method.localSignature, points: method.points, scopes: method.scopes.map((scope, index) => ({
        start: scope.start, end: scope.end, locals: scope.names.map((name, slot) => ({ name, slot })),
        constants: index === 0 ? [{ name: 'Answer', type: 'int', value: 42 }] : [],
      })) }],
    custom,
  };
  const envelope = { baselineId: history.baselineId, previousPdbId: history.pdbId, generation: 1,
    typeSystemRowCounts: generation.typeSystemRowCounts, deltaRowCounts };
  const output = emitPortablePdbDelta(debug, envelope);
  const generated = join(temporary, 'written.pdb');
  await writeFile(generated, output.bytes);
  const project = join(temporary, 'project');
  const executable = join(temporary, 'output');
  await cp(join(root, 'packages/symbols/interop/PdbGenerations'), project, { recursive: true });
  const sdk = run(['--version']);
  run(['build', join(project, 'PdbGenerations.csproj'), '-o', executable, '--nologo', '--ignore-failed-sources',
    '-m:1', '-p:UseSharedCompilation=false', '-nodeReuse:false']);
  const native = JSON.parse(run([join(executable, 'PdbGenerations.dll'), 'inspect', generated]));
  assert.deepEqual(native.mapping, generation.symbols.mapping);
  assert.deepEqual(native.methods[0].points, method.points);
  assert.equal(native.methods[0].token, method.token);
  assert.equal(native.methods[0].localSignature, method.localSignature);
  assert.deepEqual(native.methods[0].scopes, method.scopes);
  assert.deepEqual(native.constants, [{ name: 'Answer', signature: '082a000000' }]);
  assert.deepEqual(native.custom, [{ parent: 0x06000001, kind: custom[0].kind, bytes: 'deadbeef' }]);
  const parsed = readPortablePdbDelta(output.bytes, { typeSystemRowCounts: envelope.typeSystemRowCounts });
  assert.equal(parsed.custom[0].parent, method.token);
  assert.equal(parsed.constants[0].value, 42);
  history.append(output.bytes, output);
  assert.deepEqual(history.getMethodByVersion(method.token, 2).points, method.points);
  const reference = { schemaVersion: 1, sdk, runtime: native.runtime, envelope,
    sha256: digest(output.bytes), native, nativeSourceSha256: digest(await readFile(join(project, 'Program.cs'))) };
  const capture = process.argv.indexOf('--capture');
  if (capture >= 0) {
    const destination = resolve(process.argv[capture + 1]);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'written.pdb'), output.bytes);
    await writeFile(join(destination, 'reference.json'), JSON.stringify(reference, null, 2) + '\n');
  }
  console.log(JSON.stringify({ passed: true, sdk, runtime: native.runtime, methods: native.methods.length }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
