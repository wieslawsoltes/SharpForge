import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectPinnedFixtures, writeSelectedPins } from '../packages/compiler/test/differential/tools/pin-selection.mjs';

const fixture = id => ({ id, feature: id.split('/')[0], kind: 'output', hash: 'source:' + id });
const fixtures = ['owned/first', 'owned/second', 'other/third'].map(fixture);
const ids = selected => selected.map(value => value.id);
const current = value => value === fixtures[1];
const hashOf = value => value.hash;
const captured = value => ({ hash: value.hash, kind: value.kind, diagnostics: [], output: value.id + '\n' });
const meta = { informationalVersion: 'test-only-reference', runtime: 'test-only-runtime' };

test('pin selection defaults to all fixtures and applies --changed after selection', () => {
  assert.deepEqual(ids(selectPinnedFixtures([], fixtures, current)), ids(fixtures));
  assert.deepEqual(ids(selectPinnedFixtures(['--changed'], fixtures, current)), ['owned/first', 'other/third']);
  assert.deepEqual(ids(selectPinnedFixtures(['--only', 'owned/second', '--changed'], fixtures, current)), []);
});

test('pin selection accepts repeatable exact ids and comma lists in request order', () => {
  const args = ['--only=other/third,owned/second', '--only', 'owned/first'];
  assert.deepEqual(ids(selectPinnedFixtures(args, fixtures, current)), ['other/third', 'owned/second', 'owned/first']);
  assert.deepEqual(ids(selectPinnedFixtures([...args, '--changed'], fixtures, current)), ['other/third', 'owned/first']);
});

test('pin selection rejects unknown, duplicate and empty ids before checking currency', () => {
  const neverCheck = () => { assert.fail('invalid selections must not reach the currency filter'); };
  for (const args of [
    ['--only', 'owned'], ['--only', 'owned/missing'],
    ['--only', 'owned/first,owned/first'], ['--only', 'owned/first', '--only=owned/first'],
    ['--only'], ['--only', '--changed'], ['--only='], ['--only', 'owned/first,'],
  ]) assert.throws(() => selectPinnedFixtures([...args, '--changed'], fixtures, neverCheck), /--only/);
});

test('incremental pin writes preserve unrelated files and unselected rows, appending only selected new ids', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-selected-pins-'));
  try {
    const old = { hash: 'old', kind: 'diagnostics', diagnostics: [['CS0000', 0, 1, 'error']] };
    const ownedPath = join(directory, 'owned.json');
    writeFileSync(ownedPath, JSON.stringify({ roslyn: meta, shape: 'retained shape', fixtures: {
      'owned/unselected': old, 'owned/second': old,
    } }));
    const untouched = ' { "roslyn": {}, "fixtures": { "other/third": { "output": "keep bytes" } } }\r\n';
    writeFileSync(join(directory, 'other.json'), untouched);
    writeFileSync(join(directory, 'notes.txt'), 'unrelated evidence\n');
    const selected = [fixtures[1], fixtures[0]], results = new Map(selected.map(value => [value.id, captured(value)]));
    writeSelectedPins(meta, selected, results, directory, hashOf);
    assert.equal(readFileSync(join(directory, 'other.json'), 'utf8'), untouched);
    assert.equal(readFileSync(join(directory, 'notes.txt'), 'utf8'), 'unrelated evidence\n');
    const written = JSON.parse(readFileSync(ownedPath, 'utf8'));
    assert.deepEqual(Object.keys(written.fixtures), ['owned/unselected', 'owned/second', 'owned/first']);
    assert.deepEqual(written.fixtures['owned/unselected'], old);
    assert.deepEqual(written.fixtures['owned/second'], captured(fixtures[1]));
    assert.deepEqual(written.fixtures['owned/first'], captured(fixtures[0]));
    assert.equal(written.shape, 'retained shape');
    assert.deepEqual(readdirSync(directory).sort(), ['notes.txt', 'other.json', 'owned.json']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('pin writes validate every source hash before changing any file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-invalid-pins-'));
  try {
    const path = join(directory, 'owned.json');
    const previous = '{"roslyn":{},"fixtures":{}}\n';
    writeFileSync(path, previous);
    const results = new Map([[fixtures[0].id, captured(fixtures[0])]]);
    assert.throws(() => writeSelectedPins(meta, fixtures, results, directory, hashOf), /Missing or stale/);
    results.set(fixtures[1].id, { ...captured(fixtures[1]), hash: 'not-the-current-source' });
    assert.throws(() => writeSelectedPins(meta, fixtures.slice(0, 2), results, directory, hashOf), /Missing or stale/);
    assert.equal(readFileSync(path, 'utf8'), previous);
    assert.deepEqual(readdirSync(directory), ['owned.json']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('an empty pin selection does not create the destination', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-empty-pins-'));
  try {
    const destination = join(directory, 'absent');
    writeSelectedPins(meta, [], new Map(), destination, hashOf);
    assert.equal(existsSync(destination), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
