import test from 'node:test';
import assert from 'node:assert/strict';
import {parseQualificationOptions} from '../bench/vm/qualification-options.js';
import {qualificationTargets, selectQualificationTargets} from '../bench/vm/qualification-fixtures.js';

test('focused qualification retains every original target and its exact acceptance policy', () => {
  const definitions = qualificationTargets();
  assert.equal(selectQualificationTargets().length, definitions.length);
  for (const definition of definitions) {
    const selected = selectQualificationTargets(definition.id);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].id, definition.id);
    assert.deepEqual(selected[0].target, definition.target);
    assert.deepEqual(selected[0].baselineOptions, definition.baselineOptions);
    assert.deepEqual(selected[0].candidateOptions, definition.candidateOptions);
  }
  assert.throws(() => selectQualificationTargets('unknown-target'), /Unknown qualification target/);
});

test('a target selector is explicit and cannot accidentally narrow another qualification suite', () => {
  const options = parseQualificationOptions(['--runner', 'unit-fixture', '--suite', 'targets',
    '--target', 'scalar-slot-loads', '--samples', '100']);
  assert.equal(options.target, 'scalar-slot-loads');
  assert.equal(options.samples, 100);
  for (const suite of ['all', 'differential', 'roots', 'fairness', 'profiler']) {
    assert.throws(() => parseQualificationOptions(['--runner', 'unit-fixture', '--suite', suite,
      '--target', 'scalar-slot-loads']), /requires the targets suite/);
  }
});
