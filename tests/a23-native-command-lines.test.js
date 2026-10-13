import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCscArguments, expandCscResponseFiles, validateOutputProperties, validateBuildArguments,
  validateResponseFiles, splitCommandLine, parseSarif, DiagnosticCollector } from '@sharpforge/msbuild';

for (const properties of [{ OutputPath: '../../x' }, { PublishDir: '/tmp/output' }, { BaseIntermediateOutputPath: 'C:\\temp' },
  { ArtifactsPath: '$(OtherPath)' }, { OutputPath: '%2e%2e/x' }]) {
  test('output policy rejects ' + JSON.stringify(properties), () => assert.throws(() => validateOutputProperties(properties)));
}
test('logger and response switch validation rejects ungranted execution paths and recursive traversal', async () => {
  assert.throws(() => validateBuildArguments(['-logger:evil.dll']), /elevated/);
  assert.doesNotThrow(() => validateBuildArguments(['-logger:approved.dll'], { elevated: true }));
  const files = new Map([['first.rsp', '@second.rsp'], ['second.rsp', '-p:OutputPath=../escape']]);
  await assert.rejects(() => validateResponseFiles(['@first.rsp'], path => files.get(path)), /escapes/);
  files.set('second.rsp', '@first.rsp');
  await assert.rejects(() => validateResponseFiles(['@first.rsp'], path => files.get(path)), /cycle/);
  await assert.rejects(() => validateResponseFiles(['@../../outside.rsp'], () => ''), /inside/);
  assert.deepEqual(splitCommandLine('/reference:"path with spaces/a.dll" /define:A;B'),
    ['/reference:path with spaces/a.dll', '/define:A;B']);
});

const commandLines = [
  ['/define:A;B /langversion:preview', value => assert.deepEqual(value.defines, ['A', 'B'])],
  ['/nullable:enable /unsafe+ /checked+', value => assert(value.unsafe && value.checked && value.nullable === 'enable')],
  ['/reference:alias1,alias2="a b.dll"', value => assert.deepEqual(value.references[0], { path: 'a b.dll', aliases: ['alias1', 'alias2'] })],
  ['/analyzer:a.dll /additionalfile:data.json', value => assert.deepEqual(value.additionalFiles, ['data.json'])],
  ['/analyzerconfig:rules.editorconfig', value => assert.deepEqual(value.analyzerConfigFiles, ['rules.editorconfig'])],
  ['/nowarn:CS1000,CS1001 /warnaserror:CS1002', value => assert.deepEqual(value.warningsAsErrors, ['CS1002'])],
  ['/warnaserror+ /warnaserror-:CS2000', value => assert(value.allWarningsAsErrors && value.warningsNotAsErrors[0] === 'CS2000')],
  ['/out:App.dll /target:exe', value => assert(value.target === 'exe' && value.output === 'App.dll')],
  ['/unknown:kept Program.cs', value => assert.deepEqual(value.unknown, ['/unknown:kept'])],
  ['/unsafe- /checked- /d:ONE,ONE', value => assert(!value.unsafe && !value.checked && value.defines.length === 1)]
];
for (const [line, verify] of commandLines) test('compiler option preservation: ' + line, () => verify(parseCscArguments(line)));
test('compiler response expansion rejects cycles and preserves unknown arguments', async () => {
  const files = { 'a.rsp': '/define:ONE @b.rsp', 'b.rsp': '/future:flag Program.cs' };
  const argumentsList = await expandCscResponseFiles(['@a.rsp'], path => files[path]);
  assert.deepEqual(parseCscArguments(argumentsList).unknown, ['/future:flag']);
  files['b.rsp'] = '@a.rsp';
  await assert.rejects(() => expandCscResponseFiles(['@a.rsp'], path => files[path]), /cycle/);
});
test('compiler inputs preserve absolute source paths and bound aggregate argument/response text', async () => {
  assert.deepEqual(parseCscArguments(['/tmp/Program.cs', '/Program.cs', '/future:Program.cs']).sources, ['/tmp/Program.cs', '/Program.cs']);
  assert.throws(() => parseCscArguments(['abcd', 'efgh'], { maxCharacters: 7 }), /character limit/);
  await assert.rejects(expandCscResponseFiles(['@a.rsp', '@b.rsp'], () => 'Program.cs', { maxCharacters: 15 }), /text limit/);
});
test('SARIF preserves suppressed diagnostics, rule help and related locations', () => {
  const diagnostics = parseSarif({ version: '2.1.0', runs: [{ tool: { driver: { rules: [{ id: 'CS0168', helpUri: 'https://example.test/rule' }] } },
    results: [{ ruleId: 'CS0168', level: 'warning', message: { text: 'Unused variable' }, suppressions: [{ kind: 'inSource' }],
      locations: [{ physicalLocation: { artifactLocation: { uri: 'Program.cs' }, region: { startLine: 3, startColumn: 2 } } }],
      relatedLocations: [{ id: 1, message: { text: 'Related declaration' } }] }] }] });
  assert.equal(diagnostics[0].suppressed, true);
  assert.equal(diagnostics[0].helpUri, 'https://example.test/rule');
  assert.equal(diagnostics[0].relatedLocations.length, 1);
});
test('diagnostic stream preserves continuation text and removes summary duplicates', () => {
  const collector = new DiagnosticCollector();
  collector.accept('App.csproj : warning NU1605: Package downgrade [App.csproj]');
  collector.accept('    A -> B (>= 2.0)');
  collector.accept('App.csproj : warning NU1605: Package downgrade [App.csproj]');
  assert.equal(collector.diagnostics.length, 1);
  assert.deepEqual(collector.diagnostics[0].relatedMessages, ['A -> B (>= 2.0)']);
  collector.accept('NuGet.targets(12,3): error : Credentials item is incomplete [App.csproj]');
  assert.equal(collector.diagnostics[1].code, 'SFMSB_UNCODED');
  assert.equal(collector.diagnostics[1].line, 12);
});
