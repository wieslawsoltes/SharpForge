import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { isBclNamespace, bclNamespaceNames } from '../packages/compiler/src/symbols/bcl-namespaces.js';
import { fixtures } from '../packages/compiler/test/differential/fixtures/usings.js';
import { loadPinned, fixtureHash } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';

const pinned = loadPinned().results;
const rows = diagnostics =>
  diagnostics
    .filter(d => /^CS\d{4}$/.test(d.code) && d.severity !== 'hidden')
    .map(d => [d.code, d.start, d.length, d.severity])
    .sort((a, b) => a[1] - b[1] || a[2] - b[2] || (a[0] < b[0] ? -1 : 1));

test('A02-T24 the using fixtures are pinned from Roslyn and cover the namespace diagnostics', () => {
  assert(fixtures.length >= 20);
  const codes = new Set();
  for (const fixture of fixtures) {
    const pin = pinned.get(fixture.id);
    assert(pin, `${fixture.id} is not pinned`);
    assert.equal(pin.hash, fixtureHash(fixture), `${fixture.id}: stale pin`);
    for (const row of pin.diagnostics) codes.add(row[0]);
  }
  for (const code of ['CS0105', 'CS0138', 'CS0234', 'CS0246', 'CS0431', 'CS0432', 'CS0576', 'CS1537', 'CS7007']) {
    assert(codes.has(code), `no fixture pins ${code}`);
  }
});

for (const fixture of fixtures) {
  test(`A02-T24 the semantic analysis matches Roslyn codes and spans: ${fixture.id}`, () => {
    const file = parse(new SourceText(fixture.source, 'Program.cs'));
    const result = analyze([file]);
    assert.deepEqual(rows([...file.diagnostics, ...result.diagnostics]), pinned.get(fixture.id).diagnostics);
  });
}

for (const fixture of fixtures.filter(f => f.kind === 'diagnostics')) {
  test(`A02-T24 compile() matches Roslyn codes and spans: ${fixture.id}`, () => {
    const row = runFixture(fixture, pinned.get(fixture.id));
    assert.equal(row.unsupported, false, JSON.stringify(row.details));
    assert.equal(row.diagnostics, true, JSON.stringify(row.details));
    assert.equal(row.warnings, true, JSON.stringify(row.details));
  });
}

test('A02-T24 BCL namespaces come from an explicit list, not from a name pattern', () => {
  const names = bclNamespaceNames();
  assert(names.length > 120);
  for (const name of ['System', 'System.Xml', 'System.Xml.Linq', 'System.Runtime.InteropServices', 'Microsoft.Win32', 'Microsoft']) {
    assert(isBclNamespace(name), name);
  }
  for (const name of ['System.Nope', 'System.Text.Missing', 'Microsoft.Nope', 'Windows', 'Nope', 'system', 'System.']) {
    assert(!isBclNamespace(name), name);
  }
  // Every parent of a listed namespace is listed.
  for (const name of names) {
    const dot = name.lastIndexOf('.');
    if (dot > 0) assert(isBclNamespace(name.slice(0, dot)), name);
  }
});

test('A02-T24 a BCL namespace outside the registry is accepted and a program using it still compiles', () => {
  const source = 'using System.Xml;\nusing System.Runtime.InteropServices;\nclass P { static void Main() { System.Console.WriteLine(1); } }';
  const result = compile(source);
  assert.equal(result.success, true);
  assert.deepEqual(rows(result.diagnostics), []);
  // The same program with a namespace that does not exist fails with Roslyn's code on the unknown name.
  const broken = compile(source.replace('System.Xml', 'System.Xmlx'));
  assert.equal(broken.success, false);
  assert.deepEqual(rows(broken.diagnostics), [['CS0234', 13, 4, 'error']]);
  assert.match(broken.diagnostics.find(d => d.code === 'CS0234').message, /'Xmlx' does not exist in the namespace 'System'/);
});

test('A02-T24 qualified names report the first unknown part', () => {
  const source = 'class P { static void Main() { System.Nope.Thing a = null; System.Xml.XmlDocument d = null; object o = a; o = d; } }';
  const file = parse(new SourceText(source, 'Program.cs'));
  const result = analyze([file]);
  assert.deepEqual(rows(result.diagnostics), [['CS0234', source.indexOf('Nope'), 4, 'error']]);
  assert.equal(result.incomplete, true, 'System.Xml.XmlDocument is a BCL type the registry does not model');
});
