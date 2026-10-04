import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTypeRename} from '@sharpforge/compiler';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {SourceText} from '@sharpforge/text';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';
import {registerTypeRenameHandlers} from '../apps/studio/workers/type-rename.js';

function edited(files, edits) {
  return files.map(file => {
    let text = file.text;
    for (const edit of edits.filter(edit => edit.uri === file.uri).sort((left, right) => right.start - left.start)) {
      text = text.slice(0, edit.start) + edit.newText + text.slice(edit.end);
    }
    return {...file, text};
  });
}

const options = {uri: 'Widget.cs', name: 'Widget', newName: 'Renamed', compilationOptions: {outputKind: 'library'}};

test('A24 type rename binds declarations, constructors, annotations, static access and creation across files', () => {
  const files = [{uri: 'Widget.cs', text: 'namespace App { public partial class Widget { public Widget() {} public static int Value = 3; } }'},
    {uri: 'Extra.cs', text: 'namespace App { public partial class Widget { public Widget Copy(Widget value) { return value; } } }'},
    {uri: 'Use.cs', text: 'namespace App { class Use { Widget field = new Widget(); public Widget[] Make(Widget input) { ' +
      'Widget local = input; int Widget = 7; return new Widget[] { local, new Widget() }; } public int Read() { return Widget.Value; } } }'}];
  const plan = prepareTypeRename(files, options);
  assert.equal(plan.available, true, plan.reason);
  const output = edited(files, plan.edits);
  assert(output[0].text.includes('partial class Renamed { public Renamed()'));
  assert(output[1].text.includes('Renamed Copy(Renamed value)'));
  assert(output[2].text.includes('int Widget = 7;'));
  assert(output[2].text.includes('Renamed.Value'));
  assert(output[2].text.includes('new Renamed[]'));
  assert.equal(files[0].text.includes('class Renamed'), false);
});

test('A24 same-spelled types, value members, comments and strings are not changed by textual coincidence', () => {
  const files = [{uri: 'Widget.cs', text: 'namespace A { public class Widget { public Widget() {} } }'},
    {uri: 'Other.cs', text: 'namespace B { public class Widget {} }'},
    {uri: 'Use.cs', text: 'class Use { A.Widget first = new A.Widget(); B.Widget other = new B.Widget(); ' +
      'string text = "Widget"; int Widget = 1; public int Read() { return Widget; } } // Widget'}];
  const plan = prepareTypeRename(files, options);
  assert.equal(plan.available, true, plan.reason);
  const output = edited(files, plan.edits);
  assert(output[2].text.includes('A.Renamed first = new A.Renamed()'));
  assert(output[2].text.includes('B.Widget other = new B.Widget()'));
  assert(output[2].text.includes('"Widget"'));
  assert(output[2].text.includes('return Widget;'));
  assert(output[2].text.endsWith('// Widget'));
  assert.equal(output[1].text, files[1].text);
});

test('A24 type rename rejects name capture, unsupported reference sources, invalid names and limits visibly', () => {
  const cases = [
    {text: 'class Widget {} class Renamed {}', reason: /CS0101|binding/},
    {text: 'using Alias = Widget; class Widget {} class Use { Alias value; }', reason: /aliases/},
    {text: '/// <see cref="Widget"/>\nclass Widget {}', reason: /cref/},
    {text: '#if NEVER\nclass Hidden { Widget value; }\n#endif\nclass Widget {}', reason: /inactive/},
    {text: 'class Widget { Missing value; }', reason: /valid semantic|incomplete/},
  ];
  for (const value of cases) {
    const plan = prepareTypeRename([{uri: 'Widget.cs', text: value.text}], options);
    assert.equal(plan.available, false, value.text);
    assert.match(plan.reason, value.reason);
    assert.equal(plan.edits.length, 0);
    assert.match(plan.diagnostic.code, /^SFL240/);
  }
  assert.equal(prepareTypeRename([{uri: 'Widget.cs', text: 'class Widget {}'}], {...options, newName: 'class'}).diagnostic.code, 'SFL2402');
  assert.equal(prepareTypeRename([{uri: 'Widget.cs', text: 'class Widget {}'}], {...options, maxFiles: 0}).diagnostic.code, 'SFL2405');
  const abort = new AbortController();
  abort.abort();
  assert.throws(() => prepareTypeRename([{uri: 'Widget.cs', text: 'class Widget {}'}], {...options, signal: abort.signal}), /abort/i);
});

test('A24 semantic preview handles generic and nested type identities or reports an explicit complete-binding boundary', () => {
  const files = [{uri: 'Widget.cs', text: 'class Widget<T> { public Widget() {} public class Nested {} }'},
    {uri: 'Use.cs', text: 'class Use { Widget<int> value = new Widget<int>(); Widget<int>.Nested nested; }'}];
  const plan = prepareTypeRename(files, options);
  assert.equal(plan.available, true, plan.reason);
  const output = edited(files, plan.edits);
  assert(output[0].text.includes('class Renamed<T> { public Renamed()'));
  assert(output[1].text.includes('Renamed<int>.Nested'));
});

test('A24 public language and worker preview preserve versions and reject generated/unloaded inputs', () => {
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  workspace.update('Widget.cs', 'class Widget {}', 3);
  workspace.update('Use.cs', 'class Use { Widget value; }', 7);
  const language = new LanguageService(workspace);
  const handlers = createWorkerProtocol('compiler');
  registerTypeRenameHandlers(handlers, {language, refactoring: {rename: () => ({edits: []})}});
  const plan = handlers.dispatch('prepareTypeRename', {uri: 'Widget.cs', name: 'Widget', newName: 'Renamed'});
  assert.equal(plan.available, true, plan.reason);
  assert.deepEqual(plan.documents.map(document => document.version), [3, 7]);
  assert.equal(workspace.documents.get('Widget.cs').source.text, 'class Widget {}');
  assert.equal(language.rename('Widget.cs', 7, 'Renamed').length, 2);
  workspace.generatedDocuments.set('generated://Test.g.cs', {
    source: new SourceText('class Generated { Widget value; }', 'generated://Test.g.cs', 1)});
  assert.match(language.prepareTypeRename('Widget.cs', null, 'Renamed', {name: 'Widget'}).reason, /generated/);
  workspace.generatedDocuments.clear();
  workspace.documentStore = {entries: new Map([['Closed.cs', {path: 'Closed.cs', compile: true}]])};
  assert.match(language.prepareTypeRename('Widget.cs', null, 'Renamed', {name: 'Widget'}).reason, /unloaded/);
  handlers.dispose();
});

