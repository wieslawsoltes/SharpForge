import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeZip } from '../packages/archive/src/index.js';
import { computePublicKeyToken, nearestTargetFramework, selectNugetPackage, readDependencyManifest,
  LoadErrorCode } from '../packages/clr/src/index.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/clr-identity/${name}.json`, import.meta.url)));

test('CLR tokens match .NET ECMA and Microsoft assembly keys', async () => {
  const reference = fixture('public-keys');
  assert.ok(reference.cases.length >= 3);
  for (const row of reference.cases) {
    const bytes = Uint8Array.from(row.key.match(/../g), pair => parseInt(pair, 16));
    assert.equal(await computePublicKeyToken(bytes), row.token, row.name);
  }
});

test('CLR 30 package-layout matrix selects the same TFM as native NuGet FrameworkReducer', () => {
  const reference = fixture('frameworks');
  assert.equal(reference.cases.length, 30);
  for (const row of reference.cases) {
    assert.equal(nearestTargetFramework(row.target, row.candidates), row.nearest, row.package);
    const files = row.candidates.flatMap(tfm => [
      { path: `lib/${tfm}/${row.package}.dll`, bytes: Uint8Array.of(1, 2, 3) },
      { path: `lib/${tfm}/${row.package}.xml`, text: 'documentation' },
    ]);
    const archive = writeZip(files);
    const selected = selectNugetPackage(archive, { targetFramework: row.target });
    assert.equal(selected.framework, row.nearest, row.package);
    assert.deepEqual(selected.paths, row.nearest ? [`lib/${row.nearest}/${row.package}.dll`] : []);
    if (selected.assets.length) assert.deepEqual(selected.assets[0].bytes, Uint8Array.of(1, 2, 3));
  }
  assert.throws(() => selectNugetPackage(new Uint8Array(), { targetFramework: 'net10.0' }),
    error => error.code === LoadErrorCode.InvalidImage);
  assert.throws(() => selectNugetPackage(new Uint8Array(), { signal: AbortSignal.abort() }),
    error => error.code === LoadErrorCode.Cancelled);
});

test('CLR deps application paths match dotnet --depsfile host tracing and trusted assembly list', () => {
  const reference = fixture('trusted-paths');
  assert.match(reference.traceSha256, /^[a-f\d]{64}$/);
  const actual = readDependencyManifest(fixture('published.deps'), fixture('published.runtimeconfig'), { appRoot: '$APP' });
  assert.deepEqual(actual.assemblies.map(assembly => assembly.path).sort(), reference.applicationPaths);
});
