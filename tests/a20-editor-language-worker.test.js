import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {LanguageServer} from '@sharpforge/protocol';
import {RefactoringEngine, foldingRanges, formatDocument, selectionRanges} from '@sharpforge/refactoring';
import {SourceText} from '@sharpforge/text';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';
import {registerEditorLanguageHandlers} from '../apps/studio/workers/editor-language.js';
import {createRequestServices} from '../packages/editor/src/services/providers.js';

function fixture(text = 'int F(int x, int y){return x+y;}\nvar answer=F(1,2);\nConsole.WriteLine(answer);') {
  const workspace = new Workspace();
  workspace.update('Program.cs', text, 7);
  const language = new LanguageService(workspace);
  const refactoring = new RefactoringEngine(workspace, language);
  const handlers = createWorkerProtocol('compiler');
  const dispose = registerEditorLanguageHandlers(handlers, {workspace, language, refactoring});
  const request = (method, parameters = {}) => handlers.dispatch(method, {uri: 'Program.cs', version: 7, ...parameters});
  return {workspace, language, refactoring, handlers, request, dispose, text};
}

test('compiler contribution reuses real language endpoints with explicit client aliases', async () => {
  const {language, request, text} = fixture();
  const offset = text.lastIndexOf('answer') + 2;
  for (const [method, expected] of [
    ['completion', language.completions('Program.cs', offset)],
    ['hover', language.hover('Program.cs', offset)],
    ['definition', language.definition('Program.cs', offset)],
    ['references', language.references('Program.cs', offset)],
    ['symbols', language.documentSymbols('Program.cs')],
    ['referenceLenses', language.referenceLenses('Program.cs')]
  ]) assert.deepEqual(request(method, {offset}), expected, method);
  const services = createRequestServices((method, parameters) => request(method, parameters),
    [{method: 'documentSymbols', remote: 'symbols'}, {method: 'codeLens', remote: 'referenceLenses'},
      {method: 'folding', remote: 'foldingRanges'}, 'selectionRanges']);
  assert.deepEqual(await services.invoke('documentSymbols', {}), language.documentSymbols('Program.cs'));
  assert.deepEqual(await services.invoke('codeLens', {}), language.referenceLenses('Program.cs'));
  assert.equal(services.supports('rename'), false);
});

test('diagnostic and semantic results are versioned, source faithful and reject stale snapshots', () => {
  const {language, request} = fixture('int answer="wrong";\nConsole.WriteLine(answer);');
  assert.deepEqual(request('diagnostics'), {version: 7, items: language.diagnostics('Program.cs')});
  assert(request('diagnostics').items.some(item => item.code === 'CS0029'));
  assert.deepEqual(request('semanticTokens'), {version: 7, items: language.semanticTokens('Program.cs')});
  for (const method of ['diagnostics', 'semanticTokens', 'foldingRanges', 'inlayHints', 'symbols', 'format']) {
    assert.throws(() => request(method, {version: 6}), {code: 'SFED1202'});
    assert.throws(() => request(method, {uri: 'missing.cs'}), {code: 'SFED1201'});
  }
});

test('signature request uses provider symbols for nested invocations and preserves active argument', () => {
  const text = 'int Outer(int a,int b,int c){return a+b+c;} int Inner(int x,int y){return x+y;}\n' +
    'Console.WriteLine(Outer(1, Inner(2,3), 4));';
  const {language, request} = fixture(text);
  const callStart = text.lastIndexOf('Outer(') + 'Outer'.length;
  const offset = text.lastIndexOf(', 4') + 2;
  const result = request('signatureHelp', {offset, callStart, activeParameter: 2});
  assert.deepEqual(result.signatures, language.signatureHelp('Program.cs', callStart + 1).signatures);
  assert(result.signatures[0].label.includes('Outer'));
  assert.equal(result.activeParameter, 2);
  assert.equal(result.version, 7);
  assert.throws(() => request('signatureHelp', {offset, callStart: callStart - 1}), {code: 'SFED1203'});
  const spaced = fixture('int Δοκιμή(int x){return x;} Console.WriteLine(Δοκιμή (1));');
  const help = spaced.request('signatureHelp', {offset: spaced.text.lastIndexOf('(1') + 1});
  assert(help.signatures.some(signature => signature.label.includes('Δοκιμή')));
});

test('inlay hints share one bound implementation with the existing LSP contract', async () => {
  const {workspace, language, request, text} = fixture();
  const source = workspace.documents.get('Program.cs').source;
  const hints = language.inlayHints('Program.cs');
  const typeHints = hints.filter(hint => hint.kind === 1);
  assert.equal(typeHints.length, 1);
  assert.equal(typeHints[0].label, ': int');
  assert.equal(source.offsetAt(typeHints[0].position), text.indexOf('answer') + 6);
  assert(hints.some(hint => hint.kind === 2 && hint.label === 'x:'));
  assert(hints.some(hint => hint.kind === 2 && hint.label === 'y:'));
  assert.deepEqual(request('inlayHints'), {version: 7, items: hints});
  const lsp = new LanguageServer({workspace});
  const response = await lsp.handle({jsonrpc: '2.0', id: 1, method: 'textDocument/inlayHint', params: {
    textDocument: {uri: 'Program.cs'}, range: {start: source.positionAt(0), end: source.positionAt(source.length)}
  }});
  assert.deepEqual(response.result, hints);
  assert.deepEqual(language.inlayHints('Program.cs', {start: 0, end: 5}), []);
  assert.throws(() => language.inlayHints('Program.cs', {start: -1}), /Invalid/);
});

test('rename and refactoring requests return versioned edits without committing source', () => {
  const {workspace, language, refactoring, request, text} = fixture();
  const offset = text.lastIndexOf('answer') + 1;
  assert.deepEqual(request('rename', {offset, newName: 'result'}), refactoring.rename('Program.cs', offset, 'result').edits);
  assert.deepEqual(request('prepareRename', {offset}), language.prepareRename('Program.cs', offset));
  assert.deepEqual(request('documentHighlights', {offset}).items,
    language.references('Program.cs', offset).map(reference => ({...reference, kind: reference.write ? 3 : reference.read ? 2 : 1})));
  const start = text.indexOf('answer');
  assert.deepEqual(request('codeActions', {offset: start}), refactoring.actions('Program.cs', start, start));
  assert.equal(workspace.documents.get('Program.cs').source.text, text);
  assert.equal(workspace.documents.get('Program.cs').source.version, 7);
  assert.deepEqual(request('rename', {offset, newName: 'result', includeStrings: true}),
    refactoring.rename('Program.cs', offset, 'result', {includeStrings: true}).edits);
  assert.throws(() => request('codeActions', {offset, scope: 'project', equivalenceKey: 'sharpforge.local.explicit-type'}), /ownership/);
  const types = fixture('class C { public static int F(){return 1;} } Console.WriteLine(C.F());');
  assert.equal(types.request('prepareRename', {offset: 6}).placeholder, 'C');
});

test('format selection/on-type adapt existing indentation edits and preserve unrelated lines', () => {
  const text = 'class C {\r\nstatic void M() {\r\nConsole.WriteLine(1);\r\n}\r\n}\r\n';
  const {workspace, request} = fixture(text);
  const source = workspace.documents.get('Program.cs').source;
  const all = formatDocument(workspace, 'Program.cs');
  assert.deepEqual(request('format'), {title: 'Format document indentation', edits: all});
  const start = text.indexOf('Console');
  const end = text.indexOf('\r\n', start);
  const expected = all.filter(edit => edit.start >= start && edit.start <= end);
  assert(expected.length > 0);
  assert.deepEqual(request('formatRange', {start, end}), expected);
  assert.deepEqual(request('formatOnType', {start, end, character: ';'}), expected);
  assert.deepEqual(request('formatOnType', {start, end, character: 'x'}), []);
  assert.deepEqual(request('foldingRanges'), foldingRanges(workspace, 'Program.cs'));
  assert.deepEqual(request('selectionRanges', {offsets: [start]}), selectionRanges(workspace, 'Program.cs', [start]));
  assert.equal(workspace.documents.get('Program.cs').source.text, text);
  assert.throws(() => request('formatRange', {start: source.length + 1, end}), {code: 'SFED1203'});
});

test('generated peek targets retain their own URI/version and are explicitly read-only', () => {
  const {workspace, request, handlers, dispose} = fixture();
  workspace.generatedDocuments.set('generated.g.cs', {source: new SourceText('class Generated {}', 'generated.g.cs', 3)});
  assert.deepEqual(request('readDocument', {targetUri: 'generated.g.cs'}), {
    uri: 'generated.g.cs', text: 'class Generated {}', version: 3, readOnly: true
  });
  assert.equal(request('readDocument').readOnly, false);
  assert.throws(() => request('readDocument', {targetUri: 'missing.cs'}), {code: 'SFED1201'});
  dispose();
  assert.throws(() => handlers.dispatch('signatureHelp', {}), {code: 'UNKNOWN_METHOD'});
});
