import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGallery, validateDump, compareObservation, statusTable } from '../../../scripts/conformance/winui-gallery/catalog.js';
import { runCandidate } from '../../../scripts/conformance/winui-gallery/candidate.js';
import { captureGallery } from '../../../scripts/conformance/winui-gallery/capture.js';
import { requireTarget } from '../../../scripts/conformance/oracle/toolchain.js';

const catalog = await loadGallery();

test('Gallery provenance covers every pinned page and retains both upstream source forms', () => {
  assert.equal(catalog.upstream.commit, '535ce178dbd6ebe24fe63e444b66344d007bdabe');
  assert.equal(catalog.upstream.pages.length, 125);
  assert.equal(new Set(catalog.upstream.pages.map(row => row.control)).size, 125);
  assert.equal(catalog.upstream.license, 'MIT');
  for (const control of new Set(catalog.cases.map(row => row.control))) {
    assert(catalog.upstream.files.some(row => row.path.endsWith(`/${control}Page.xaml`)));
    assert(catalog.upstream.files.some(row => row.path.endsWith(`/${control}Page.xaml.cs`)));
    assert(catalog.cases.some(row => row.control === control && row.kind === 'positive'));
    assert(catalog.cases.some(row => row.control === control && row.kind === 'boundary'));
  }
  assert.equal(catalog.cases.filter(row => row.kind === 'negative').length, 3);
});

// Synthetic rows below exercise validation only; they are never persisted as oracle evidence.
function syntheticDump() {
  return { schemaVersion: 1, oracle: 'winui-gallery', target: 'win32-x64', cases: catalog.cases.map(fixture => {
    const observation = fixture.kind === 'negative' ? { rejected: true, exception: 'Synthetic.TestException' } :
      { rejected: false, properties: fixture.expected };
    return { id: fixture.id, inputHash: fixture.inputHash, xaml: observation,
      ...(fixture.source ? { csharp: observation } : {}) };
  }) };
}

test('Gallery dumps reject missing, stale, duplicate, wrong-platform and incomplete observations', () => {
  assert.doesNotThrow(() => validateDump(syntheticDump(), catalog));
  for (const change of [
    dump => { dump.target = 'linux-x64'; },
    dump => { dump.cases.pop(); },
    dump => { dump.cases[0] = dump.cases[1]; },
    dump => { dump.cases[0].inputHash = '0'.repeat(64); },
    dump => { delete dump.cases[0].csharp; },
    dump => { dump.cases[0].xaml.properties = {}; },
  ]) {
    const dump = structuredClone(syntheticDump());
    change(dump);
    assert.throws(() => validateDump(dump, catalog));
  }
});

test('Gallery comparison never treats rejection or changed properties as accepted parity', () => {
  const expected = { rejected: false, properties: { Width: 0 } };
  assert(compareObservation(expected, structuredClone(expected)));
  assert(!compareObservation({ rejected: true }, expected));
  assert(!compareObservation({ rejected: false, properties: { Width: 1 } }, expected));
  const table = statusTable(catalog);
  assert(table.includes('Not ported'));
  assert(table.includes('Native capture pending'));
  assert.equal(table.split('\n').filter(line => line.startsWith('| ')).length, 127);
});

test('Gallery Button baseline consumes the real source engine', async () => {
  const fixture = catalog.cases.find(row => row.id === 'button-positive');
  const result = await runCandidate(fixture, 'source');
  assert.equal(result.status, 'observed', JSON.stringify(result));
  assert.deepEqual(result.observation, { rejected: false, properties: fixture.expected });
});

test('Gallery CIL observation preserves the known boolean property mismatch', async () => {
  const fixture = catalog.cases.find(row => row.id === 'button-positive');
  const result = await runCandidate(fixture, 'cil');
  assert.equal(result.status, 'observed', JSON.stringify(result));
  // Keep the raw engine value: coercing it would hide a product qualification gap.
  assert.deepEqual(result.observation, {
    rejected: false, properties: { ...fixture.expected, IsEnabled: 1 },
  });
  assert.equal(compareObservation(result.observation,
    { rejected: false, properties: fixture.expected }), false);
});

test('Gallery XAML and non-Windows native availability remain explicit', async () => {
  const result = await runCandidate(catalog.cases.find(row => row.id === 'malformed'), 'source');
  assert.equal(result.status, 'unsupported');
  await assert.rejects(runCandidate(catalog.cases[0], 'simulator'), /Unknown Gallery engine/);
  if (!requireTarget('winui').supported) assert.equal((await captureGallery()).status, 'unsupported');
});
