import test from 'node:test';
import assert from 'node:assert/strict';
import {languageFixtures} from './fixtures/language/parity-boundaries.js';
import {compareEngineResults} from './support/engine-parity-harness.js';

test('fault parity rejects a shared zero-exit regression even when every route agrees', () => {
  const faults = languageFixtures.filter(fixture => fixture.expected?.state === 'faulted');
  assert.equal(faults.length, 6);
  for (const fixture of faults) {
    assert.equal(fixture.expected.exitCode, -532462766);
    const expected = {...fixture.expected};
    const routes = value => ({source: {...value}, 'reloaded-source': {...value}, cil: {...value}});
    assert.doesNotThrow(() => compareEngineResults(fixture, routes(expected)));
    assert.throws(() => compareEngineResults(fixture, routes({...expected, exitCode: 0})), /source expected exitCode/);
    assert.throws(() => compareEngineResults(fixture, routes({...expected, exceptionType: 'System.InvalidProgramException'})),
      /source expected exceptionType/);
    assert.throws(() => compareEngineResults(fixture, routes({...expected, output: expected.output + 'unexpected\n'})),
      /source expected output/);
    if (expected.diagnosticName) {
      assert.throws(() => compareEngineResults(fixture, routes({...expected, diagnosticName: 'ExecutionEngineException'})),
        /source expected diagnosticName/);
    }
  }
});

test('successful parity retains zero as the default expected exit', () => {
  const fixture = {id: 'successful default', expected: {output: 'done\n'}};
  const result = {state: 'terminated', output: 'done\n', exceptionType: null, exitCode: 0};
  assert.doesNotThrow(() => compareEngineResults(fixture, {source: result, cil: {...result}}));
  const incorrect = {...result, exitCode: -532462766};
  assert.throws(() => compareEngineResults(fixture, {source: incorrect, cil: {...incorrect}}), /source expected exitCode/);
});
