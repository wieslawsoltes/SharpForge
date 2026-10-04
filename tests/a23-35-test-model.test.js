import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestCase, createTestResult, createTestTree, defineTestAdapter} from '../packages/msbuild/src/testing/model.js';
import {parseNativeTestDiscovery} from '../packages/msbuild/src/testing/discovery.js';

test('A23 T35 native and portable TestCase identities agree after source metadata enrichment', () => {
  const portable = createTestCase({project: 'Tests/Tests.csproj', fqn: 'Example.Tests.Add', displayName: 'Example.Tests.Add(value: 2)',
    arguments: [2], traits: {Category: ['Unit']}, source: {path: 'Tests.cs', line: 4}});
  const native = parseNativeTestDiscovery('The following Tests are available:\n    Example.Tests.Add(value: 2)\n',
    {project: portable.project, sourceTests: [portable]});
  assert.equal(native.tests[0].id, portable.id);
  assert.deepEqual(native.tests[0].traits, portable.traits);
  assert.equal(native.tests[0].source.line, 4);
  const tree = createTestTree([portable]);
  assert.equal(tree[0].children[0].children[0].id, portable.id);
  assert.equal(createTestResult(portable, {outcome: 'passed'}).durationMs, 0);
});

test('A23 T35 rejects duplicate identities, malformed records, invalid durations and incomplete adapters', () => {
  const value = createTestCase({project: 'Tests.csproj', fqn: 'A.B'});
  assert.throws(() => createTestCase({project: '', fqn: 'A.B'}), /project/);
  assert.throws(() => createTestCase({project: 'Tests.csproj', fqn: 'A.B', source: {path: 'A.cs', line: 0}}), /source/);
  assert.throws(() => createTestTree([value, value]), /Duplicate/);
  assert.throws(() => createTestResult(value, {outcome: 'success'}), /outcome/);
  assert.throws(() => createTestResult(value, {outcome: 'passed', durationMs: -1}), /duration/);
  assert.throws(() => defineTestAdapter({id: 'incomplete'}), /discover/);
  assert.doesNotThrow(() => JSON.stringify(value));
});
