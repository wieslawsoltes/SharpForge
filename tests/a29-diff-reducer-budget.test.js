import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { hydrateFixture } from '../scripts/conformance/diff/fixtures.js';
import { reduceFixture } from '../scripts/conformance/diff/reduce.js';

const source = 'class Program { static void Main() { int unused = 1; } }';
const fixture = hydrateFixture({
  id: 'reducer-budget', source: 'Program.cs', entry: 'Main', stdin: '',
  capabilities: ['runtime.execution'], seed: 1729, normalisers: [], langVersion: '12.0',
}, source);
const difference = {
  class: 'runtime', engines: ['clr-sharpforge', 'cil-vm'],
  statuses: ['completed', 'completed'], phase: 'execute',
};
const reproduced = { differences: [difference] };

test('reducer timeout settles an uncooperative original observer and aborts its signal', { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let observationSignal;
  const pending = reduceFixture(fixture, difference, (_candidate, options) => {
    observationSignal = options.signal;
    t.mock.timers.tick(60000);
    return new Promise(() => {});
  }, { signal: controller.signal, timeoutMs: 60000 });
  await assert.rejects(pending, { code: 'budget-exceeded' });
  assert.equal(observationSignal.aborted, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('reducer retains the reproduced source when a later observation exceeds the budget', { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  let timedOutSignal;
  const result = await reduceFixture(fixture, difference, (_candidate, options) => {
    if (++attempts === 1) return reproduced;
    timedOutSignal = options.signal;
    t.mock.timers.tick(60000);
    return new Promise(() => {});
  }, { timeoutMs: 60000 });
  assert.equal(attempts, 2);
  assert.equal(result.source, source);
  assert.equal(result.budgetExhausted, true);
  assert.equal(result.minimalAtStatementMemberGranularity, false);
  assert.equal(timedOutSignal.aborted, true);
});

test('reducer cancellation settles an observer that ignores cancellation', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  let observationSignal;
  const pending = reduceFixture(fixture, difference, (_candidate, options) => {
    observationSignal = options.signal;
    controller.abort();
    return new Promise(() => {});
  }, { signal: controller.signal, timeoutMs: 1000 });
  await assert.rejects(pending, { code: 'cancelled' });
  assert.equal(observationSignal.aborted, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('reducer keeps observer failures distinct and removes cancellation listeners', async () => {
  const controller = new AbortController();
  const failure = Object.assign(new Error('observer failed'), { code: 'budget-exceeded' });
  await assert.rejects(reduceFixture(fixture, difference, () => { throw failure; }, {
    signal: controller.signal,
  }), error => error === failure);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const result = await reduceFixture(fixture, difference, () => reproduced, {
    signal: controller.signal, maxAttempts: 1,
  });
  assert.equal(result.source, source);
  assert.equal(result.budgetExhausted, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('reducer observes late rejection without changing an exhausted result', { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let rejectObservation;
  const pending = reduceFixture(fixture, difference, () => new Promise((resolve, reject) => {
    rejectObservation = reject;
    t.mock.timers.tick(60000);
  }), { timeoutMs: 60000 });
  await assert.rejects(pending, { code: 'budget-exceeded' });
  rejectObservation(new Error('observer rejected after timeout'));
  await new Promise(resolve => setImmediate(resolve));
});
