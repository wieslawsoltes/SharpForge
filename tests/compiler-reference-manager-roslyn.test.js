import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { compile } from '@sharpforge/compiler';
import { assemblies, scenarios } from '../packages/compiler/test/references/fixtures.js';
import { importAssembly } from '../packages/compiler/src/metadata-import/pe-symbols.js';

// Roslyn's results for the reference scenarios, pinned by packages/compiler/test/references/tools/generate.mjs.
const root = new URL('../packages/compiler/test/references/', import.meta.url);
const pinned = JSON.parse(readFileSync(new URL('pinned.json', root), 'utf8'));
const bytes = file => new Uint8Array(readFileSync(new URL('assemblies/' + file, root)));
const core = new Uint8Array(readFileSync(new URL('./fixtures/metadata/MiniStandard.dll', import.meta.url)));

/** The compile() references of a scenario: the core library first, then its assemblies with their extern aliases. */
function referencesOf(scenario) {
  const references = [{ bytes: core, display: 'MiniStandard.dll' }];
  for (const reference of scenario.references) {
    const { file, aliases } = typeof reference === 'string' ? { file: reference } : reference;
    references.push({ bytes: bytes(file), display: file, ...(aliases ? { aliases } : {}) });
  }
  return references;
}
/**
 * C# diagnostics as Roslyn rows. Roslyn reports reference diagnostics such as CS1701 without a source location
 * (start -1); SharpForge diagnostics always have a span, so for the codes Roslyn pinned without a location only
 * the code, severity and message are compared (the convention of the differential harness).
 */
function rowsOf(result, expected, withMessage) {
  const unlocated = new Set(expected.filter(row => row[1] < 0).map(row => row[0]));
  return result.diagnostics
    .filter(d => /^CS\d{4}$/.test(d.code) && d.severity !== 'hidden')
    .map(d => {
      const located = !unlocated.has(d.code);
      return [d.code, located ? d.start : -1, located ? d.length : 0, d.severity, ...(withMessage ? [d.message] : [])];
    })
    .sort((a, b) => a[1] - b[1] || a[2] - b[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

test('A02-T22 the checked-in fixture assemblies are the ones Roslyn built', () => {
  const files = readdirSync(new URL('assemblies/', root)).sort();
  assert.deepEqual(files, Object.keys(pinned.assemblies).sort());
  assert.deepEqual(files, assemblies.filter(a => a.build !== false).map(a => a.file).sort());
  for (const file of files) {
    const image = bytes(file);
    assert.equal(image.length, pinned.assemblies[file].bytes, file);
    assert.equal(importAssembly(image).identity.getDisplayName(), pinned.assemblies[file].identity, file);
  }
  assert.match(pinned.roslyn, /^\d+\.\d+\.\d+\.\d+$/);
});

test('A02-T22 every reference scenario is pinned and covers the reference diagnostics', () => {
  assert.deepEqual(Object.keys(pinned.results).sort(), scenarios.map(s => s.id).sort());
  const codes = new Set(Object.values(pinned.results).flatMap(rows => rows.map(row => row[0])));
  for (const code of ['CS0012', 'CS0430', 'CS0433', 'CS1069', 'CS1701', 'CS1702', 'CS1704', 'CS1705']) {
    assert(codes.has(code), `no scenario pins ${code}`);
  }
  // Roslyn's default identity comparer never reports CS1703: two references with one identity are one assembly.
  assert.deepEqual(pinned.results['duplicate/same-identity-different-content'], []);
});

for (const scenario of scenarios) {
  test(`A02-T22 compile() matches Roslyn: ${scenario.id}`, () => {
    const result = compile(scenario.source, { references: referencesOf(scenario), ...scenario.options });
    const expected = pinned.results[scenario.id];
    assert.deepEqual(
      rowsOf(result, expected, false),
      expected.map(row => row.slice(0, 4)),
    );
    // Reference diagnostics carry assembly identities and display names; their text is compared as well.
    const referenceCodes = new Set(['CS0012', 'CS0430', 'CS0433', 'CS1701', 'CS1702', 'CS1703', 'CS1704', 'CS1705', 'CS1069']);
    assert.deepEqual(
      rowsOf(result, expected, true).filter(row => referenceCodes.has(row[0])),
      expected.filter(row => referenceCodes.has(row[0])),
    );
  });
}
