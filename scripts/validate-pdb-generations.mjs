import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PortablePdbGenerations, readPortablePdb, readPortablePdbDelta } from '@sharpforge/symbols';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dotnet = process.env.DOTNET_PATH ?? 'dotnet';
const temporary = await mkdtemp(join(tmpdir(), 'sharpforge-pdb-generations-'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (args) => {
  const result = spawnSync(dotnet, args, {
    encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' },
  });
  if (result.error || result.status !== 0) throw Error(result.error?.message ?? result.stdout + result.stderr);
  return result.stdout.trim();
};

try {
  const project = join(temporary, 'project');
  const output = join(temporary, 'output');
  const fixtures = join(temporary, 'fixtures');
  await cp(join(root, 'packages/symbols/interop/PdbGenerations'), project, { recursive: true });
  const sdk = run(['--version']);
  run(['build', join(project, 'PdbGenerations.csproj'), '-o', output, '--nologo', '--ignore-failed-sources',
    '-m:1', '-p:UseSharedCompilation=false', '-nodeReuse:false']);
  const executable = join(output, 'PdbGenerations.dll');
  const reference = JSON.parse(run([executable, 'capture', fixtures]));
  const baseline = await readFile(join(fixtures, 'baseline.pdb'));
  const history = new PortablePdbGenerations(baseline);
  for (const item of reference.generations) {
    const name = item.generation === 0 ? 'baseline.pdb' : `delta${item.generation}.pdb`;
    const bytes = await readFile(join(fixtures, name));
    const symbols = item.generation === 0 ? readPortablePdb(bytes) :
      readPortablePdbDelta(bytes, { typeSystemRowCounts: item.typeSystemRowCounts });
    assert.equal(symbols.idHex, item.symbols.id);
    assert.deepEqual(symbols.documents.map(({ id, name }) => ({ id, name })), item.symbols.documents);
    for (const method of item.symbols.methods) {
      const actual = symbols.methods.find((record) => record.token === method.token);
      assert(actual);
      assert.equal(actual.localSignature, method.localSignature);
      assert.deepEqual(actual.points, method.points);
      assert.deepEqual(symbols.scopes.filter((scope) => scope.methodToken === method.token).map((scope) => ({
        start: scope.start, end: scope.end, names: scope.variables.map((local) => local.name),
      })), method.scopes);
    }
    if (item.generation) history.append(bytes, {
      baselineId: history.baselineId, previousPdbId: history.pdbId, generation: item.generation,
      typeSystemRowCounts: item.typeSystemRowCounts, pdbId: item.symbols.id,
    });
  }
  const updated = reference.generations[1].symbols.methods[0].token;
  const original = reference.generations[0].symbols.methods.find((method) => method.token === updated);
  assert.deepEqual(history.getMethodByVersion(updated, 1).points, original.points);
  assert.deepEqual(history.getMethodByVersion(updated, 2).points, reference.generations[1].symbols.methods[0].points);
  assert.equal(history.getMethodByVersion(updated, 3).generation, 1);
  const artifacts = {};
  for (const file of (await readdir(fixtures)).sort()) artifacts[file] = digest(await readFile(join(fixtures, file)));
  const record = { ...reference, sdk, artifacts, qualification: 'native Roslyn EmitDifference and SRM, Linux host; no runtime ApplyUpdate' };
  const capture = process.argv.indexOf('--capture');
  if (capture >= 0) {
    const destination = resolve(process.argv[capture + 1]);
    await mkdir(destination, { recursive: true });
    await cp(fixtures, destination, { recursive: true });
    await writeFile(join(destination, 'reference.json'), JSON.stringify(record, null, 2) + '\n');
  }
  console.log(JSON.stringify({ passed: true, sdk, runtime: reference.runtime, generations: reference.generations.length }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
