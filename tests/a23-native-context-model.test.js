import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectContext, contextFromEvaluation, projectContextCompilationInput, ProjectContextSelection } from '@sharpforge/msbuild';

test('contexts retain independent TFM/RID identity and inactive diagnostic labels', () => {
  const evaluation = { Properties: { TargetFramework: 'net10.0', RuntimeIdentifier: 'linux-x64', DefineConstants: 'A;B', Nullable: 'enable' },
    Items: { Compile: [{ FullPath: '/workspace/Program.cs' }], ReferencePath: [{ FullPath: '/sdk/System.Runtime.dll' }] } };
  const context = contextFromEvaluation('App.csproj', evaluation, { diagnostics: [{ code: 'CS1000', message: 'failure' }] });
  const other = contextFromEvaluation('App.csproj', { ...evaluation, Properties: { ...evaluation.Properties, TargetFramework: 'net8.0' } });
  assert.notEqual(context.id, other.id);
  assert.deepEqual(context.defines, ['A', 'B']);
  assert.equal(context.diagnostics[0].targetFramework, 'net10.0');
  const selection = new ProjectContextSelection();
  selection.update([context, other]);
  selection.select('App.csproj', other.id);
  assert.equal(selection.get('App.csproj'), other);
  assert.equal(selection.diagnostics()[0].contextId, context.id);
});
test('context compilation input preserves generated flags and rejects unhydrated documents explicitly', () => {
  const context = createProjectContext({ project: 'App.csproj', sources: [{ path: 'Program.cs' }],
    generatedSources: [{ path: 'obj/Generated.cs', text: '// generated', generated: true, readOnly: true }],
    defines: ['B', 'A'], langVersion: '12.0' });
  assert.throws(() => projectContextCompilationInput(context), { code: 'SFMSB_CONTEXT_SOURCE_MISSING', path: 'Program.cs' });
  const input = projectContextCompilationInput(context, new Map([['Program.cs', 'Console.WriteLine(42);']]));
  assert.equal(input.files[1].readOnly, true);
  assert.equal(input.files[1].generated, true);
  assert.equal(input.options.langVersion, '12');
  assert.deepEqual(input.options.defines, ['A', 'B']);
});

