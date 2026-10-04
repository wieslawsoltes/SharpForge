import test from 'node:test';
import assert from 'node:assert/strict';
import { contextFromPortableEvaluation } from '@sharpforge/msbuild';

test('A23 portable context reference aliases retain case-insensitive evaluated metadata', () => {
  for (const name of ['Aliases', 'aliases', 'aLiAsEs']) {
    const evaluation = { path: 'App.csproj', name: 'App', outputType: 'Library', properties: {}, compile: [], generatedSources: [],
      references: [{ hintPath: 'Library.dll', metadata: { [name]: 'first,second' } }],
      analyzers: [], additionalFiles: [], imports: [], projectReferences: [], diagnostics: [], artifacts: [] };
    const context = contextFromPortableEvaluation(evaluation);
    assert.deepEqual(context.references, [{ path: 'Library.dll', aliases: ['first', 'second'] }]);
  }
});
