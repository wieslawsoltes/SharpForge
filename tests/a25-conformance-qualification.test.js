import test from 'node:test';
import assert from 'node:assert/strict';
import { createQualificationPlan } from '../packages/git/scripts/qualify.js';

test('package qualification registry keeps focused, pack-memory and full benchmark stages serial and explicit', () => {
  const plan = createQualificationPlan(['a25-z.test.js', 'unrelated.test.js', 'a25-a.test.js', '../a25-outside.test.js']);
  assert.deepEqual(plan.map(stage => stage.name), ['node', 'pack-memory', 'benchmark']);
  for (const stage of plan) assert.equal(stage.args[0], 'scripts/limited.js');
  const node = plan[0].args;
  assert.ok(node.includes('--test-concurrency=1'));
  assert.deepEqual(node.filter(value => value.startsWith('tests/')), ['tests/a25-a.test.js', 'tests/a25-z.test.js']);
  assert.equal(plan[1].args.includes('--quick'), false);
  assert.equal(plan[2].args.includes('--quick'), false);
  assert.equal(plan[2].args.includes('--baseline'), false);
});

test('qualification accepts a bounded scope and requires a supplied baseline only when explicitly requested', () => {
  const plan = createQualificationPlan([], { scopes: ['benchmark'], baseline: 'measured.json', requireBaseline: true });
  assert.equal(plan.length, 1);
  assert.ok(plan[0].args.includes('--baseline'));
  assert.throws(() => createQualificationPlan([], { scopes: ['benchmark'], requireBaseline: true }), /baseline/);
  assert.throws(() => createQualificationPlan([], { scopes: ['unknown'] }), /scope/);
  assert.throws(() => createQualificationPlan([], { scopes: ['node'] }), /no focused/);
});
