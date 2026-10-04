import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeSourceRecords} from '../apps/studio/workers/runtime-sources.js';

test('worker source publication retains graph provenance without transferring metadata tables', () => {
  const record = {...source('Library', 'code'), project: 'Library.csproj', contextId: 'net10', generated: true, internal: 'private'};
  const output = runtimeSourceRecords({vm: {image: {sources: [record]}}});
  assert.deepEqual(output, [{uri: record.uri, text: 'code', originalUri: 'Shared.cs', assemblyKey: 'Library',
    project: 'Library.csproj', contextId: 'net10', generated: true}]);
  assert.equal(output[0].internal, undefined);
});
