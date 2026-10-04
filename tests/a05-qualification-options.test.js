import test from 'node:test';
import assert from 'node:assert/strict';
import {parseQualificationOptions} from '../bench/vm/qualification-options.js';
import {qualificationAcceptance} from '../bench/vm/qualification.js';

test('qualification defaults retain the actual full acceptance counts and explicit runner', () => {
  const options = parseQualificationOptions(['--runner', 'unit-fixture']);
  assert.equal(options.int32Cases, 1000000);
  assert.equal(options.int64Cases, 10000000);
  assert.equal(options.arrayElements, 1000000);
  assert.equal(options.profilerReference, null);
  assert.equal(options.samples, 20);
  assert.throws(() => parseQualificationOptions([]), /Invalid/);
});

test('qualification options reject unsafe sizes, duplicate flags and accidental reference overwrite', () => {
  for (const args of [['--samples', '19'], ['--warmup', '0'], ['--int64-cases', '10000001'], ['--array-elements', '1'],
    ['--suite', 'made-up'], ['--width', '16'], ['--seed', '-1'], ['--timeout-seconds', 'Infinity'],
    ['--samples', '20', '--samples', '21'], ['--not-an-option', 'yes'], ['--out', 'same.json', '--profiler-reference', 'same.json']]) {
    assert.throws(() => parseQualificationOptions(['--runner', 'unit-fixture', ...args]));
  }
});

test('qualification never promotes unavailable, reduced-count or uncertain targets to completion', () => {
  const row = acceptance => ({target: {acceptance}});
  assert.equal(qualificationAcceptance([row('met')]), 'met');
  assert.equal(qualificationAcceptance([row('met'), row('missed')]), 'missed');
  assert.equal(qualificationAcceptance([row('unavailable'), row('missed')]), 'missed');
  assert.equal(qualificationAcceptance([row('met'), row('inconclusive')]), 'inconclusive');
  assert.equal(qualificationAcceptance([row('met'), row('partial')]), 'incomplete');
  assert.equal(qualificationAcceptance([row('unavailable')]), 'incomplete');
  assert.equal(qualificationAcceptance([row('met'), {required: false, target: {acceptance: 'reported'}}]), 'met');
  assert.equal(qualificationAcceptance([]), 'incomplete');
});
