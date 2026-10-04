import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverFixtures, fixtureModuleNames, validateFixtures, fixturesDirectory } from '../packages/compiler/test/differential/fixture-discovery.js';
import {
  loadBaseline,
  saveBaseline,
  BASELINE_AXES,
  baselineDirectory,
} from '../packages/compiler/test/differential/baseline-store.js';
import { loadFixtures, savePinned } from '../packages/compiler/test/differential/corpus-store.js';
import { loadFixtures as loadReexportedFixtures } from '../packages/compiler/test/differential/corpus.js';

// SF-A02-T40: the differential corpus is discovered from fixtures/ and its baseline is stored per feature, so that
// parallel pull requests do not meet on one registry line or one baseline file.

/** A scratch directory outside the repository, removed when the test ends. */
function scratch(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sf-differential-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeModules(directory, modules) {
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
  for (const [name, text] of Object.entries(modules)) writeFileSync(join(directory, name), text);
}

const fixture = (id, kind = 'output') => ({ id, feature: id.split('/')[0], kind, source: 'class C {}' });

test('A02-T40 discovery: every module exporting `fixtures` contributes, in file-name order', async t => {
  const directory = scratch(t);
  writeModules(directory, {
    'zeta.js': "export const fixtures = [{ id: 'zeta/one', feature: 'zeta', kind: 'output', source: 'class Z {}' }];\n",
    'alpha.js': "export const fixtures = [{ id: 'alpha/one', feature: 'alpha', kind: 'diagnostics', source: 'class A {' }];\n",
    'kit.js': 'export const helper = () => 1;\n',
    'notes.txt': 'not a module\n',
  });
  assert.deepEqual(fixtureModuleNames(directory), ['alpha.js', 'kit.js', 'zeta.js']);
  const found = await discoverFixtures(directory);
  assert.deepEqual(
    found.map(f => f.id),
    ['alpha/one', 'zeta/one'],
  );
});

test('A02-T40 discovery: a module that re-exports fixtures of another module does not duplicate them', async t => {
  const directory = scratch(t);
  writeModules(directory, {
    'family.js': "export const fixtures = [{ id: 'family/one', feature: 'family', kind: 'output', source: 'class F {}' }];\n",
    'group.js': "import { fixtures as family } from './family.js';\nexport const fixtures = [...family];\n",
  });
  const found = validateFixtures(await discoverFixtures(directory));
  assert.equal(found.length, 1);
});

test('A02-T40 discovery: a `fixtures` export that is not an array is rejected', async t => {
  const directory = scratch(t);
  writeModules(directory, { 'broken.js': 'export const fixtures = { id: 1 };\n' });
  await assert.rejects(discoverFixtures(directory), /fixtures\/broken\.js: the 'fixtures' export must be an array/);
});

test('A02-T40 discovery: invalid and duplicate fixtures are rejected', () => {
  assert.throws(() => validateFixtures([fixture('Bad/Id')]), /Invalid fixture id/);
  assert.throws(() => validateFixtures([fixture('no-feature')]), /Invalid fixture id/);
  assert.throws(() => validateFixtures([fixture('a/one'), fixture('a/one')]), /Duplicate fixture id a\/one/);
  assert.throws(() => validateFixtures([fixture('a/one', 'other')]), /kind must be 'output' or 'diagnostics'/);
  assert.throws(() => validateFixtures([{ ...fixture('a/one'), source: '  ' }]), /empty source/);
  assert.equal(validateFixtures([fixture('a/one'), fixture('a/two', 'diagnostics')]).length, 2);
});

test('A02-T40 discovery: the corpus holds the fixtures of every module in fixtures/', async () => {
  const discovered = await discoverFixtures();
  const corpus = loadFixtures();
  assert.deepEqual(corpus.map(f => f.id).sort(), discovered.map(f => f.id).sort());
  const modules = fixtureModuleNames(fixturesDirectory);
  assert.ok(modules.includes('kit.js') && modules.length > 10, 'fixtures/ holds the kit and the fixture families');
  for (const item of corpus) assert.equal(item.id.split('/')[0], item.feature, `${item.id}: the id starts with the feature`);
});

test('A02-T40 baseline: one file per feature, one fixture per line, and a lossless round trip', t => {
  const directory = join(scratch(t), 'baseline');
  const baseline = {
    diagnostics: ['beta/two', 'alpha/one', 'beta/one'],
    warnings: ['alpha/one', 'beta/one'],
    bytecode: ['alpha/one'],
    cil: ['alpha/one', 'beta/two'],
    directCil: ['beta/two'],
  };
  saveBaseline(baseline, directory);
  assert.deepEqual(readdirSync(directory).sort(), ['alpha.json', 'beta.json']);
  assert.equal(readFileSync(join(directory, 'alpha.json'), 'utf8'), '{\n  "alpha/one": ["diagnostics", "warnings", "bytecode", "cil"]\n}\n');
  assert.equal(
    readFileSync(join(directory, 'beta.json'), 'utf8'),
    '{\n  "beta/one": ["diagnostics", "warnings"],\n  "beta/two": ["diagnostics", "cil", "directCil"]\n}\n',
  );
  const reloaded = loadBaseline(directory);
  for (const axis of BASELINE_AXES) assert.deepEqual(reloaded[axis], [...baseline[axis]].sort(), axis);
});

test('A02-T40 baseline: saving removes features that no longer pass and leaves unchanged files alone', t => {
  const directory = join(scratch(t), 'baseline');
  saveBaseline({ diagnostics: ['alpha/one', 'beta/one'], warnings: [], bytecode: [], cil: [] }, directory);
  const alpha = join(directory, 'alpha.json');
  const past = new Date(Date.UTC(2020, 0, 1));
  utimesSync(alpha, past, past);
  saveBaseline({ diagnostics: ['alpha/one'], warnings: [], bytecode: [], cil: [] }, directory);
  assert.deepEqual(readdirSync(directory), ['alpha.json']);
  assert.equal(statSync(alpha).mtimeMs, past.getTime(), 'an unchanged feature file is not rewritten');
  assert.deepEqual(loadBaseline(directory).diagnostics, ['alpha/one']);
});

test('A02-T40 baseline: a missing directory is an empty baseline; misplaced ids and unknown axes are rejected', t => {
  const directory = join(scratch(t), 'baseline');
  assert.deepEqual(loadBaseline(directory), { diagnostics: [], warnings: [], bytecode: [], cil: [], directCil: [] });
  mkdirSync(directory);
  writeFileSync(join(directory, 'alpha.json'), '{"beta/one": ["diagnostics"]}\n');
  assert.throws(() => loadBaseline(directory), /baseline\/alpha\.json: beta\/one belongs to feature 'beta'/);
  writeFileSync(join(directory, 'alpha.json'), '{"alpha/one": ["speed"]}\n');
  assert.throws(() => loadBaseline(directory), /unknown axis 'speed'/);
});

test('A02-T40 baseline: the checked-in baseline only names fixtures of the corpus', () => {
  const ids = new Set(loadFixtures().map(f => f.id));
  const baseline = loadBaseline(baselineDirectory);
  for (const axis of BASELINE_AXES) {
    assert.ok(baseline[axis].length > 0, `${axis} has entries`);
    for (const id of baseline[axis]) assert.ok(ids.has(id), `${axis}: ${id} is not a fixture`);
  }
});

test('A02-T40 pins: a pinned fixture keeps its line and new fixtures are appended', t => {
  const directory = join(scratch(t), 'pinned');
  const fixtures = ['alpha/one', 'alpha/two', 'alpha/three'].map(id => fixture(id));
  const results = new Map(fixtures.map(f => [f.id, { hash: f.id }]));
  const idsOf = () => Object.keys(JSON.parse(readFileSync(join(directory, 'alpha.json'), 'utf8')).fixtures);
  savePinned({ version: '1.0' }, fixtures, results, directory);
  assert.deepEqual(idsOf(), ['alpha/one', 'alpha/two', 'alpha/three']);
  // The same fixtures arrive in another order (another module order) together with a new one.
  const reordered = [fixtures[2], fixture('alpha/zero'), fixtures[0], fixtures[1]];
  results.set('alpha/zero', { hash: 'zero' });
  savePinned({ version: '1.0' }, reordered, results, directory);
  assert.deepEqual(idsOf(), ['alpha/one', 'alpha/two', 'alpha/three', 'alpha/zero']);
  // A fixture that was removed loses its line; the others stay where they were.
  savePinned({ version: '1.0' }, [fixtures[2], fixtures[0]], results, directory);
  assert.deepEqual(idsOf(), ['alpha/one', 'alpha/three']);
});

test('A02-T40 corpus.js re-exports the discovered corpus', () => {
  assert.deepEqual(
    loadReexportedFixtures().map(f => f.id),
    loadFixtures().map(f => f.id),
  );
});
