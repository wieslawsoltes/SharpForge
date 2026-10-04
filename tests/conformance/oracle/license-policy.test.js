import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readInputs, validateCatalog, filterPaths } from '../../../scripts/conformance/oracle/license-policy.js';

const inputs = readInputs();
const entry = (file, mode = '100644') => ({ path: file, mode });

test('license inventory covers actual tool, NuGet, image and workflow pins', () => {
  assert.deepEqual(validateCatalog(inputs), { tools: 7, packages: 14, actions: 4, images: 3 });
  const reordered = structuredClone(inputs);
  reordered.pin.images.windows = Object.fromEntries(Object.entries(reordered.pin.images.windows).reverse());
  assert.doesNotThrow(() => validateCatalog(reordered));
});

test('pin changes and uncovered transitive dependencies require license review', () => {
  for (const change of [
    value => { value.pin.sdk = '99.0.0'; },
    value => { value.pin.windowsAppSDK = '99.0.0'; },
    value => { value.pin.images.windows.imageVersion = 'changed'; },
    value => { value.project = value.project.replace('10.0.19041.57', '99.0.0'); },
    value => { value.workflows.measure = value.workflows.measure.replace('24.21.0', '99.0.0'); },
    value => { value.workflows.oracles = value.workflows.oracles.replace(/actions\/checkout@[a-f0-9]+/g, 'actions/checkout@main'); },
    value => { Object.values(value.lock.dependencies)[0].Unreviewed = { resolved: '1.0.0', contentHash: 'new' }; },
    value => { Object.values(value.lock.dependencies)[0]['Microsoft.Web.WebView2'].contentHash = 'different'; },
  ]) {
    const changed = structuredClone(inputs); change(changed); assert.throws(() => validateCatalog(changed), /Oracle license policy/);
  }
});

test('incomplete, duplicate and stale license records fail closed', () => {
  for (const change of [
    value => value.catalog.packages.pop(),
    value => value.catalog.packages.push(value.catalog.packages[0]),
    value => { value.catalog.packages[0].license = null; },
    value => { value.catalog.tools[0].policy = 'unreviewed'; },
    value => { value.catalog.actions[0].sourceLicense = 'https://github.com/actions/checkout/blob/main/LICENSE'; },
    value => { value.catalog.pathPolicy.toolBasenames = []; },
  ]) {
    const changed = structuredClone(inputs); change(changed); assert.throws(() => validateCatalog(changed), /Oracle license policy/);
  }
});

test('downloaded payload filter preserves ordinary authored managed fixtures and JSON evidence', () => {
  const allowed = ['examples/managed/Arithmetic.dll', 'tests/fixtures/portable-pdb/Consumer.dll',
    'tests/fixtures/portable-pdb/Consumer.pdb', 'tests/conformance/expected/coreclr/10.0.5/hash.json',
    'tests/conformance/oracle/Oracle.csproj', 'tests/conformance/bcl/String.cs', 'docs/report.zip'];
  assert.deepEqual(filterPaths(allowed.map(file => entry(file)), inputs.catalog), []);
  const blocked = ['vendor/csc.dll', 'elsewhere/Microsoft.UI.Xaml.dll', 'vendor/Microsoft.WindowsAppSDK.1.8.260921001.nupkg',
    'cache/dotnet-sdk-10.0.201-win-x64.zip', 'tests/conformance/oracle/WinUI/out/host.EXE',
    'tests/conformance/bcl/result.dll', 'scripts\\conformance\\oracle\\payload.zip', 'tests/conformance/expected/hidden.so'];
  assert.deepEqual(filterPaths(blocked.map(file => entry(file)), inputs.catalog).map(row => row.path), blocked);
  assert.equal(filterPaths([entry('tests/conformance/oracle-elsewhere/Fixture.dll')], inputs.catalog).length, 0);
});

test('oracle source directories cannot redirect outside the protected tree', () => {
  for (const mode of ['120000', '160000']) for (const file of ['tests/conformance/oracle', 'tests/conformance/oracle/tools']) {
    assert.equal(filterPaths([entry(file, mode)], inputs.catalog).length, 1);
  }
});

test('authored binary exceptions require exact bytes and tracked source and never exempt SDK payloads', () => {
  const bytes = Buffer.from('authored fixture bytes, never executed'), catalog = structuredClone(inputs.catalog);
  const file = 'tests/conformance/oracle/fixtures/Boundary.dll', source = 'tests/conformance/oracle/sources/Boundary.cs';
  const exception = { path: file, source, reason: 'Generated boundary fixture', sha256: createHash('sha256').update(bytes).digest('hex') };
  catalog.pathPolicy.authoredBinaryExceptions.push(exception);
  const entries = [entry(file), entry(source)];
  assert.deepEqual(filterPaths(entries, catalog, () => bytes), []);
  assert.equal(filterPaths(entries, catalog, () => Buffer.from('changed')).length, 1);
  assert.equal(filterPaths([entry(file)], catalog, () => bytes).length, 1);
  assert.equal(filterPaths([entry(file), entry(source, '120000')], catalog, () => bytes).length, 2);
  exception.path = 'tests/conformance/oracle/csc.dll';
  assert.equal(filterPaths([entry(exception.path), entry(source)], catalog, () => bytes).length, 1);
});
