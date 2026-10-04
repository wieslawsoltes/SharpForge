import test from 'node:test';
import assert from 'node:assert/strict';
import { readNuGetPackage, selectPackageAssets } from '@sharpforge/msbuild';
import { writeZip } from '@sharpforge/archive';

test('nupkg selects ref compile assets independently from RID runtime and rejects invalid archives', () => {
  const archive = writeZip([
    { path: 'A.nuspec', text: '<package><metadata><id>A</id><version>1.0.0</version></metadata></package>' },
    { path: 'ref/net10.0/A.dll', bytes: Uint8Array.of(1) },
    { path: 'lib/net10.0/A.dll', bytes: Uint8Array.of(2) },
    { path: 'runtimes/linux-x64/lib/net10.0/A.dll', bytes: Uint8Array.of(3) },
    { path: 'runtimes/linux-x64/native/libA.so', bytes: Uint8Array.of(4) }
  ]);
  const packageData = readNuGetPackage(archive);
  const selected = selectPackageAssets(packageData, 'net10.0', { runtimeIdentifier: 'linux-x64',
    nearestFramework: (target, candidates) => candidates.includes(target) ? target : null });
  assert.deepEqual(selected.compile, ['ref/net10.0/A.dll']);
  assert.deepEqual(selected.runtime, ['runtimes/linux-x64/lib/net10.0/A.dll']);
  assert.equal(selected.native.length, 1);
  assert.throws(() => readNuGetPackage(Uint8Array.of(1, 2, 3)));
});
