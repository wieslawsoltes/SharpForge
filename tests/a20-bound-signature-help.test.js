import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {RefactoringEngine} from '@sharpforge/refactoring';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';
import {registerEditorLanguageHandlers} from '../apps/studio/workers/editor-language.js';

function fixture(t, text) {
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  workspace.update('Calls.cs', text, 11);
  const language = new LanguageService(workspace);
  const protocol = createWorkerProtocol('compiler');
  registerEditorLanguageHandlers(protocol, {workspace, language, refactoring: new RefactoringEngine(workspace, language)});
  t.after(() => protocol.dispose());
  const help = (marker, options = {}) => {
    const callStart = text.indexOf(marker) + marker.lastIndexOf('(');
    assert.ok(text.indexOf(marker) >= 0, marker);
    return protocol.dispatch('signatureHelp', {uri: 'Calls.cs', version: 11, offset: callStart + 1, ...options});
  };
  return {workspace, language, protocol, help, text};
}

const methods = 'class C { public void F(int count){} public void F(string text, int flags){} ' +
  'private void F(bool secret){} public static void F(double staticValue){} ' +
  'public void Inside(){this.F(1);} }';

test('instance receiver signature help includes its accessible instance overloads, not same-name unrelated methods', t => {
  const current = fixture(t, methods + 'class D { public void F(char wrong){} void M(){ C c=new C(); c.F("text",2); } }');
  const help = current.help('c.F(');
  assert.equal(help.version, 11);
  assert.equal(help.signatures.length, 2);
  assert.ok(help.signatures.every(signature => signature.label.includes('C.F(')));
  assert.deepEqual(help.signatures.map(signature => signature.parameters.length).sort(), [1, 2]);
  assert.equal(help.signatures[help.activeSignature].parameters[0].label, 'string text');
  assert.ok(help.signatures.every(signature => !/secret|staticValue|wrong/.test(signature.label)));
});

test('this receiver uses its containing type, preserving private overloads accessible within that type', t => {
  const {help} = fixture(t, methods);
  const result = help('this.F(');
  assert.equal(result.signatures.length, 3);
  assert.ok(result.signatures.some(signature => signature.label.includes('bool secret')));
  assert.ok(result.signatures.every(signature => !signature.label.includes('staticValue')));
  assert.equal(result.signatures[result.activeSignature].parameters[0].label, 'int count');
});

test('type receivers use static overloads and scoped receiver variables use their bound types', t => {
  const current = fixture(t, methods + 'class D { public void F(char letter){} ' +
    'void One(){C c=new C(); c.F(1);} void Two(){D c=new D(); c.F(\'x\'); C.F(1.5);} }');
  const instance = current.help("c.F('x'");
  assert.equal(instance.signatures.length, 1);
  assert.match(instance.signatures[0].label, /D\.F\(char letter\)/);
  const type = current.help('C.F(');
  assert.equal(type.signatures.length, 1);
  assert.match(type.signatures[0].label, /C\.F\(double staticValue\)/);
});

test('generic and inherited instance members display substituted parameter types', t => {
  const current = fixture(t, 'class Base<T> { public T F(T value){return value;} } class Derived:Base<int> {} ' +
    'class Use { void M(){Derived c=new Derived(); c.F(1);} }');
  const result = current.help('c.F(');
  assert.equal(result.signatures.length, 1);
  assert.equal(result.signatures[0].parameters[0].label, 'int value');
  assert.match(result.signatures[0].label, /Base<int>\.F/);
});

test('incomplete invocation recovery retains the bound this receiver before arguments or closing delimiters exist', t => {
  const current = fixture(t, 'class C { void F(int count){} void M(){this.F(');
  const result = current.help('this.F(');
  assert.equal(result.signatures.length, 1);
  assert.match(result.signatures[0].label, /C\.F\(int count\)/);
});

test('nested delimiters and named argument mapping use actual syntax and the selected overload', t => {
  const current = fixture(t, 'class C { public void F(string text,int flags){} public int G(int x,int y){return x+y;} ' +
    'void M(){C c=new C();c.F(flags:c.G(1,2),text:"a,b");} }');
  const callStart = current.text.indexOf('c.F(') + 3;
  const offset = current.text.indexOf('text:"a,b"') + 6;
  const result = current.protocol.dispatch('signatureHelp', {uri: 'Calls.cs', version: 11, callStart, offset, activeParameter: 1});
  assert.match(result.signatures[0].label, /C\.F/);
  assert.equal(result.activeParameter, 0, 'the second written argument names the first formal parameter');
  assert.equal(result.signatures[0].activeParameter, 0);
  const direct = current.language.signatureHelp('Calls.cs', offset);
  assert.deepEqual(direct.signatures, result.signatures);
  assert.equal(direct.activeParameter, 0);
});

test('unresolved receivers and stale worker snapshots never return unrelated method tips', t => {
  const current = fixture(t, 'class C { void F(int count){} void M(){missing.F(1);} }');
  assert.equal(current.help('missing.F('), null);
  assert.throws(() => current.protocol.dispatch('signatureHelp', {uri: 'Calls.cs', version: 10, offset: 1}), {code: 'SFED1202'});
  assert.throws(() => current.protocol.dispatch('signatureHelp', {uri: 'Calls.cs', version: 11, offset: 1, activeParameter: -1}),
    {code: 'SFED1203'});
  assert.throws(() => current.workspace.sourceModel().signatureHelp('Calls.cs', -1), RangeError);
});

test('worker uses syntax argument separators when a lexical hint counts a nested generic comma', t => {
  const current = fixture(t, 'class Pair<T,U>{} class C { void F(object value,int flags){} ' +
    'void M(){this.F(new Pair<int,string>(),2);} }');
  const callStart = current.text.indexOf('this.F(') + 6;
  const offset = current.text.indexOf(',2)') + 1;
  const result = current.protocol.dispatch('signatureHelp', {uri: 'Calls.cs', version: 11, callStart, offset, activeParameter: 2});
  assert.equal(result.activeParameter, 1);
  assert.equal(result.signatures[0].parameters[result.activeParameter].label, 'int flags');
});
