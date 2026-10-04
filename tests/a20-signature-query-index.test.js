import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '@sharpforge/workspace';

function workspaceOf(documents) {
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  for (const [uri, text] of Object.entries(documents)) workspace.update(uri, text, 1);
  return workspace;
}

const opening = (text, marker) => {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, marker);
  return start + marker.lastIndexOf('(');
};

test('first and repeated signature queries retain their document owner in a shared source model', () => {
  const alpha = 'class A { int F(int value){return value;} void M(){this.F(1);} }';
  const beta = 'class B { string F(string text){return text;} void M(){this.F("b");} }';
  const model = workspaceOf({'Alpha.cs': alpha, 'Beta.cs': beta}).sourceModel();
  assert.ok(model.documentSymbols('Alpha.cs').some(symbol => symbol.name === 'A'));
  assert.ok(model.documentSymbols('Beta.cs').some(symbol => symbol.name === 'B'));
  const betaStart = opening(beta, 'this.F(');
  const alphaStart = opening(alpha, 'this.F(');
  const betaHelp = model.signatureHelp('Beta.cs', betaStart + 1);
  assert.match(betaHelp.signatures[0].label, /B\.F\(string text\)/);
  const alphaHelp = model.signatureHelp('Alpha.cs', alphaStart + 1, {callStart: alphaStart});
  assert.match(alphaHelp.signatures[0].label, /A\.F\(int value\)/);
  assert.deepEqual(model.signatureHelp('Beta.cs', betaStart + 1, {callStart: betaStart}), betaHelp);
  assert.deepEqual(model.signatureHelp('Alpha.cs', alphaStart + 1), alphaHelp);
  assert.equal(model.signatureHelp('Missing.cs', 0), null);
});

test('exact opening lookup and caret lookup preserve nested-call boundaries through closing delimiters', () => {
  const text = 'class C { int G(int value){return value;} void F(int first,int second){} ' +
    'void M(){this.F(this.G(1),2);} }';
  const model = workspaceOf({'Calls.cs': text}).sourceModel();
  const outer = opening(text, 'this.F(');
  const inner = opening(text, 'this.G(');
  const innerEnd = text.indexOf(')', inner);
  const innerHelp = model.signatureHelp('Calls.cs', inner + 1);
  assert.match(innerHelp.signatures[0].label, /C\.G\(int value\)/);
  assert.deepEqual(model.signatureHelp('Calls.cs', innerEnd, {callStart: inner}), innerHelp);
  assert.equal(model.signatureHelp('Calls.cs', innerEnd + 1, {callStart: inner}), null);
  assert.equal(model.signatureHelp('Calls.cs', inner + 1, {callStart: outer + 1}), null);
  const outerHelp = model.signatureHelp('Calls.cs', inner + 1, {callStart: outer});
  assert.match(outerHelp.signatures[0].label, /C\.F\(int first, int second\)/);
  const nextArgument = innerEnd + 2;
  const afterInner = model.signatureHelp('Calls.cs', nextArgument);
  assert.deepEqual(afterInner, model.signatureHelp('Calls.cs', nextArgument, {callStart: outer}));
  assert.equal(afterInner.activeParameter, 1);
});

test('unresolved inner invocations hide an outer tip only while the caret belongs to the inner call', () => {
  const text = 'class C { void F(int first,int second){} void M(){this.F(missing.G(1),2);} }';
  const model = workspaceOf({'Calls.cs': text}).sourceModel();
  const outer = opening(text, 'this.F(');
  const inner = opening(text, 'missing.G(');
  assert.equal(model.signatureHelp('Calls.cs', inner + 1), null);
  assert.equal(model.signatureHelp('Calls.cs', inner + 1, {callStart: inner}), null);
  assert.match(model.signatureHelp('Calls.cs', inner + 1, {callStart: outer}).signatures[0].label, /C\.F/);
  const afterInner = text.indexOf(',2)', inner) + 1;
  const resumed = model.signatureHelp('Calls.cs', afterInner);
  assert.match(resumed.signatures[0].label, /C\.F/);
  assert.equal(resumed.activeParameter, 1);
});

test('a replacement source model has independent cached signatures while the captured revision remains readable', () => {
  const before = 'class C { void F(int count){} void M(){this.F(1);} }';
  const after = 'class C { void F(string text){} void M(){this.F("new");} }';
  const workspace = workspaceOf({'Calls.cs': before});
  const oldModel = workspace.sourceModel();
  const oldStart = opening(before, 'this.F(');
  const oldHelp = oldModel.signatureHelp('Calls.cs', oldStart + 1);
  workspace.update('Calls.cs', after, 2);
  const newModel = workspace.sourceModel();
  const newStart = opening(after, 'this.F(');
  assert.notEqual(newModel, oldModel);
  const newHelp = newModel.signatureHelp('Calls.cs', newStart + 1);
  assert.equal(newHelp.signatures[0].parameters[0].label, 'string text');
  assert.deepEqual(newModel.signatureHelp('Calls.cs', newStart + 1, {callStart: newStart}), newHelp);
  assert.deepEqual(oldModel.signatureHelp('Calls.cs', oldStart + 1, {callStart: oldStart}), oldHelp);
  assert.equal(oldHelp.signatures[0].parameters[0].label, 'int count');
});
