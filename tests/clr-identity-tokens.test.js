import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { AssemblyName, AssemblyLoadError, LoadErrorCode, AssemblyProvider, AssemblyResolver,
  computePublicKeyToken, normalizeAssemblyIdentity, assemblyIdentityFromRow, compareAssemblyIdentity,
  readDependencyManifest, runtimeFallbacks, nearestTargetFramework, selectNugetAssets, assetsFromProject,
} from '../packages/clr/src/index.js';

const oracle = JSON.parse(readFileSync(new URL('./fixtures/clr-identity/assembly-names.json', import.meta.url)));
const hasCode = code => error => error instanceof AssemblyLoadError && error.code === code;

test('CLR public-key tokens use SHA-1 tail reversal and honor cancellation and limits', async () => {
  const ecmaKey = Uint8Array.from('00000000000000000400000000000000'.match(/../g), pair => parseInt(pair, 16));
  assert.equal(await computePublicKeyToken(ecmaKey), 'b77a5c561934e089');
  assert.equal(await computePublicKeyToken(new Uint8Array()), '');
  await assert.rejects(computePublicKeyToken(ecmaKey, { signal: AbortSignal.abort() }), hasCode(LoadErrorCode.Cancelled));
  await assert.rejects(computePublicKeyToken(new Uint8Array(65537)), hasCode(LoadErrorCode.LimitExceeded));
  assert.throws(() => AssemblyName.parse('a'.repeat(32769)), hasCode(LoadErrorCode.LimitExceeded));
});

test('CLR metadata identity adapters validate tokens and preserve flags', async () => {
  const row = { Name: 1, Culture: 2, MajorVersion: 1, MinorVersion: 2, BuildNumber: 3, RevisionNumber: 4,
    PublicKeyOrToken: 3, Flags: 0x300 };
  const readers = { reference: true, readString: index => ['', 'Demo', 'neutral'][index], readBlob: () => new Uint8Array(8) };
  const identity = await assemblyIdentityFromRow(row, readers);
  assert.equal(identity.fullName,
    'Demo, Version=1.2.3.4, Culture=neutral, PublicKeyToken=0000000000000000, Retargetable=Yes, ContentType=WindowsRuntime');
  await assert.rejects(assemblyIdentityFromRow(row, { ...readers, readBlob: () => new Uint8Array(7) }), hasCode(LoadErrorCode.InvalidImage));
});

test('CLR identity comparison diagnoses each component with explicit version policies', () => {
  const requested = 'Demo, Version=2.1.0.0, Culture=neutral, PublicKeyToken=0123456789abcdef';
  assert.deepEqual(compareAssemblyIdentity(requested, 'Other, Version=1.0.0.0, Culture=pl-PL, PublicKeyToken=null').mismatches,
    ['name', 'culture', 'token', 'version']);
  const higher = requested.replace('2.1.0.0', '2.2.0.0');
  assert.equal(compareAssemblyIdentity(requested, higher).matches, false);
  assert.equal(compareAssemblyIdentity(requested, higher, { versionPolicy: 'higher' }).matches, true);
  assert.equal(compareAssemblyIdentity(requested, higher, { versionPolicy: 'roll-forward', rollForward: 'patch' }).matches, false);
  assert.equal(compareAssemblyIdentity(requested, higher, { versionPolicy: 'roll-forward', rollForward: 'minor' }).matches, true);
});

