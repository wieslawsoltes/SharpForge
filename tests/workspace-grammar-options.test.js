import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '@sharpforge/workspace';
import {VirtualMachine} from '@sharpforge/runtime';
import {ExtensionDriver} from '@sharpforge/extensions';

const recordField = 'class record { } class P { record value; static void Main() { } }';
const conditional = '#if ENABLED\nConsole.WriteLine(1);\n#else\nConsole.WriteLine(2);\n#endif';
const parsed = (workspace, uri) => (workspace.documents.get(uri) ?? workspace.generatedDocuments.get(uri)).parsed;
function output(result) {
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return new VirtualMachine(result.image).run().output;
}

test('workspace grammar uses configured language version and invalidates one-shot overrides', () => {
  const workspace = new Workspace({compilationOptions: {langVersion: '8'}});
  workspace.update('Program.cs', recordField);
  const original = workspace.syntax('Program.cs');
  assert.equal(original.root.members[1].members[0].kind, 'Field');
  assert.equal(workspace.compile().success, true);
  assert.equal(parsed(workspace, 'Program.cs'), original);
  const changed = workspace.compile({langVersion: '9'});
  assert.equal(changed.success, false);
  assert.notEqual(parsed(workspace, 'Program.cs'), original);
  assert.equal(changed.metrics.parsedThisCompilation, 1);
  const restored = workspace.compile();
  assert.equal(restored.success, true);
  assert.equal(restored.metrics.parsedThisCompilation, 1);
});

test('workspace per-file versions reparse only the document whose grammar changed', () => {
  const workspace = new Workspace({compilationOptions: {langVersion: '9', langVersionByUri: {'Types.cs': '8'}}});
  workspace.update('Types.cs', 'class record { } class A { record value; }');
  workspace.update('Program.cs', 'class P { static void Main() { } }');
  assert.equal(workspace.compile().success, true);
  const entry = parsed(workspace, 'Program.cs');
  const changed = workspace.compile({langVersionByUri: {'Types.cs': '9'}});
  assert.equal(changed.success, false);
  assert.equal(changed.metrics.parsedThisCompilation, 1);
  assert.equal(changed.metrics.reusedDocuments, 1);
  assert.equal(parsed(workspace, 'Program.cs'), entry);
  const restored = workspace.compile({langVersionByUri: {'Types.cs': '8.0'}});
  assert.equal(restored.success, true);
  assert.equal(restored.metrics.parsedThisCompilation, 1);
});

test('workspace symbols select actual branches and canonical equivalent grammar reuses trees', () => {
  const workspace = new Workspace();
  workspace.update('Program.cs', conditional);
  const options = {langVersion: '14', preprocessorSymbols: ['ENABLED', 'IGNORED']};
  assert.equal(output(workspace.compile(options)), '1\n');
  const original = parsed(workspace, 'Program.cs');
  const equivalent = workspace.compile({langVersion: 'latest', preprocessorSymbols: ' IGNORED;ENABLED;ENABLED '});
  assert.equal(output(equivalent), '1\n');
  assert.equal(equivalent.metrics.parsedThisCompilation, 0);
  assert.equal(parsed(workspace, 'Program.cs'), original);
  const warnings = workspace.compile({...options, warningLevel: 0, noWarn: ['CS0219'], name: 'DifferentImage'});
  assert.equal(warnings.metrics.parsedThisCompilation, 0);
  assert.equal(warnings.image.name, 'DifferentImage');
  assert.equal(parsed(workspace, 'Program.cs'), original);
  const changed = workspace.compile({preprocessorSymbols: ['IGNORED']});
  assert.equal(output(changed), '2\n');
  assert.equal(changed.metrics.parsedThisCompilation, 1);
  assert.notEqual(parsed(workspace, 'Program.cs'), original);
});

test('generated documents honor symbols and per-file grammar without rerunning unchanged generators', () => {
  const extensions = new ExtensionDriver();
  const uri = 'generated://Grammar/Generated.cs';
  extensions.registerGenerator({id: 'Grammar', generate(context) {
    context.addSource('Generated.cs', [
      'class record { } class Generated { record value; public static int Value() {',
      '#if ENABLED', 'return 1;', '#else', 'return 2;', '#endif', '} }',
    ].join('\n'));
  }});
  const workspace = new Workspace({extensions, compilationOptions: {
    langVersion: '9', langVersionByUri: {[uri]: '8'}, preprocessorSymbols: ['ENABLED'],
  }});
  workspace.update('Program.cs', 'class P { static void Main() { Console.WriteLine(Generated.Value()); } }');
  assert.equal(output(workspace.compile()), '1\n');
  const original = parsed(workspace, uri);
  assert.equal(original.root.members[1].members[0].kind, 'Field');
  const changed = workspace.compile({preprocessorSymbols: []});
  assert.equal(output(changed), '2\n');
  assert.notEqual(parsed(workspace, uri), original);
  assert.equal(extensions.metrics.generatorRuns, 1);
  const beforeVersion = parsed(workspace, uri);
  const newer = workspace.compile({preprocessorSymbols: [], langVersionByUri: {[uri]: '9'}});
  assert.equal(newer.success, false);
  assert.equal(newer.metrics.parsedThisCompilation, 1);
  assert.notEqual(parsed(workspace, uri), beforeVersion);
  assert.equal(extensions.metrics.generatorRuns, 1);
});

test('invalid compiler settings remain diagnostics and cancellation leaves syntax caches untouched', () => {
  const workspace = new Workspace();
  workspace.update('Program.cs', 'class P { static void Main() { } }');
  const original = workspace.syntax('Program.cs');
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => workspace.compile({signal: controller.signal, langVersion: '8'}), {name: 'AbortError'});
  assert.equal(parsed(workspace, 'Program.cs'), original);
  assert.throws(() => workspace.syntax('Missing.cs'), /Unknown document/);
  const badVersion = workspace.compile({langVersion: 'not-a-version'});
  assert.equal(badVersion.success, false);
  assert(badVersion.diagnostics.some(diagnostic => diagnostic.code === 'CS1617'));
  const badSymbol = workspace.compile({preprocessorSymbols: ['BAD-NAME']});
  assert.equal(badSymbol.success, true);
  assert(badSymbol.diagnostics.some(diagnostic => diagnostic.code === 'CS2029' && diagnostic.severity === 'warning'));
});


test('explicit syntax grammar changes invalidate a compilation cached under another grammar', () => {
  const workspace = new Workspace({compilationOptions: {langVersion: '8'}});
  workspace.update('Program.cs', recordField);
  const result = workspace.compile();
  assert.equal(result.success, true);
  workspace.syntax('Program.cs', {langVersion: '9'});
  const restored = workspace.compile();
  assert.equal(restored.success, true);
  assert.notEqual(restored, result);
  assert.equal(parsed(workspace, 'Program.cs').root.members[1].members[0].kind, 'Field');
});
