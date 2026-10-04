import test from 'node:test';
import assert from 'node:assert/strict';
import {Compilation} from '@sharpforge/compiler';
import {parse} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';

const uri = 'Generic.cs';
const text = 'class Receiver<T>{public T Echo(T value){return value;}} ' +
  'class Calls{void M(){Receiver<int> receiver=new Receiver<int>();receiver.Echo(1);}}';
const callStart = text.indexOf('receiver.Echo(') + 'receiver.Echo'.length;
const methodStart = text.indexOf('receiver.Echo(') + 'receiver.'.length;

function compilationOf() {
  return new Compilation([parse(new SourceText(text, uri, 8))], {outputKind: 'library', pipeline: 'bound'});
}

test('compilation semantic fallback retains diagnostics and bound trees without editor invocation records', () => {
  const compilation = compilationOf();
  const result = compilation.build();
  assert.ok(compilation.sourceAnalysisComplete, 'the generic fixture must exercise full semantic fallback');
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'SF1012'));
  assert.ok(compilation.sourceAnalysis.bound.size > 0);
  assert.equal(compilation.sourceAnalysis.invocations, null);
  const model = compilation.getSourceModel();
  assert.equal(model.analysis, compilation.sourceAnalysis, 'ordinary source queries preserve complete fallback reuse');
  assert.equal(model.result, compilation.sourceAnalysisResult);
  assert.ok(model.documentSymbols(uri).some(symbol => symbol.name === 'Receiver'));
  assert.equal(model.symbolAt(uri, methodStart).name, 'Echo');
  assert.equal(model.analysis.invocations, null, 'symbols and references do not allocate invocation records');
  assert.equal(model.signatureIndex, null);
});

test('a first post-build signature query captures privately once without mutating compilation queries or diagnostics', () => {
  const compilation = compilationOf();
  const result = compilation.build();
  const originalAnalysis = compilation.sourceAnalysis;
  const model = compilation.getSourceModel();
  const originalReference = model.referenceAt(uri, methodStart);
  const originalSymbol = model.symbolAt(uri, methodStart);
  const originalDiagnostics = JSON.stringify(result.diagnostics);
  const help = model.signatureHelp(uri, callStart + 1);
  assert.equal(help.signatures[0].label, 'int Receiver<int>.Echo(int value)');
  const captured = model.signatureIndex.analysis;
  assert.notEqual(captured, originalAnalysis);
  assert.ok(captured.invocations.get(uri) instanceof Map);
  assert.equal(captured.options.executionBuiltinAliases, originalAnalysis.options.executionBuiltinAliases);
  assert.equal(captured.files[0], originalAnalysis.files[0], 'the private analysis uses the captured parsed source');
  assert.equal(model.analysis, originalAnalysis);
  assert.equal(compilation.sourceAnalysis, originalAnalysis);
  assert.equal(originalAnalysis.invocations, null);
  assert.equal(model.referenceAt(uri, methodStart), originalReference);
  assert.equal(model.symbolAt(uri, methodStart), originalSymbol);
  assert.equal(JSON.stringify(result.diagnostics), originalDiagnostics);
  assert.deepEqual(model.signatureHelp(uri, callStart + 1, {callStart}), help);
  assert.equal(model.signatureIndex.analysis, captured, 'repeated queries reuse the private capture');
});

test('a source model created before compilation captures within its original bind and reuses it for signature help', () => {
  const compilation = compilationOf();
  const model = compilation.getSourceModel();
  assert.ok(model.analysis.invocations.get(uri) instanceof Map);
  const help = model.signatureHelp(uri, callStart + 1);
  assert.equal(help.signatures[0].parameters[0].label, 'int value');
  assert.equal(model.signatureIndex.analysis, model.analysis, 'an existing capture needs no second analysis');
  assert.deepEqual(model.signatureHelp(uri, callStart + 1, {callStart}), help);
});

test('invalid post-build signature requests do not capture or mutate the reused analysis', () => {
  const compilation = compilationOf();
  compilation.build();
  const model = compilation.getSourceModel();
  assert.equal(model.signatureHelp('Missing.cs', 0), null);
  assert.throws(() => model.signatureHelp(uri, -1), RangeError);
  assert.throws(() => model.signatureHelp(uri, callStart + 1, {callStart: callStart + 1}), RangeError);
  assert.equal(model.signatureIndex, null);
  assert.equal(model.analysis, compilation.sourceAnalysis);
  assert.equal(model.analysis.invocations, null);
});
