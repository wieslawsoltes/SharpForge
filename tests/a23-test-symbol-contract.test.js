import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverTestSymbols, testSymbolsFromTrees} from '@sharpforge/msbuild';
import {SyntaxTree} from '@sharpforge/syntax';

const source = `namespace Samples;
public class Tests {
  [global::Xunit.TheoryAttribute, Xunit.InlineData(-2, "text", null)]
  public void Case(int value, string text, object empty) { }
  public static object[][] Rows => new object[][] { new object[] { 7 }, new object[] { 8 } };
  public static object[][] Computed() { throw new System.Exception("never execute discovery"); }
  [Xunit.Fact(Skip = "later")] public void Skipped() { }
}`;

test('A23 T35 declaration records retain attributes, data constants and exact source coordinates', async () => {
  const symbols = await discoverTestSymbols([{uri: 'Tests.cs', text: source}]);
  assert.equal(symbols.diagnostics.length, 0);
  assert.equal(symbols.types[0].fqn, 'Samples.Tests');
  const method = symbols.methods.find(value => value.name === 'Case');
  assert.equal(method.fqn, 'Samples.Tests.Case');
  assert.equal(method.source.path, 'Tests.cs');
  assert.equal(method.source.line, 4);
  assert.equal(method.source.column, 15);
  assert.equal(source.slice(method.source.start, method.source.start + 4), 'Case');
  assert.deepEqual(method.parameters.map(value => value.type), ['int', 'string', 'object']);
  assert.equal(method.attributes[0].type, 'Xunit.TheoryAttribute');
  assert.deepEqual(method.attributes[1].arguments, [-2, 'text', null]);
  assert.deepEqual(symbols.types[0].dataMembers.get('Rows'), [[7], [8]]);
  assert.equal(symbols.types[0].dataProviders.get('Computed').kind, 'method');
  assert.equal(symbols.types[0].dataMembers.has('Computed'), false);
  assert.equal(symbols.methods.find(value => value.name === 'Skipped').attributes[0].named.Skip, 'later');
});

test('A23 T35 compiler-owned trees and prepared records avoid reparsing and retain projection provenance', async () => {
  const tree = SyntaxTree.parseText(source, {uri: 'Owned.cs'});
  const direct = testSymbolsFromTrees([tree]);
  const prepared = await discoverTestSymbols({trees: [tree]});
  assert.deepEqual(prepared.methods.map(value => value.fqn), direct.methods.map(value => value.fqn));
  assert.equal(prepared.sources[0].text, source);
  assert.ok(prepared.attributeSpans.every(value => value.uri === 'Owned.cs'));
  assert.ok(prepared.identifierReferences.get('Exception').length > 0);
  assert.equal(await discoverTestSymbols(prepared), prepared);
});

test('A23 T35 source discovery respects configured preprocessor symbols', async () => {
  const conditional = '#if FEATURE\nclass Enabled { public void Present() { } }\n#endif\n';
  assert.equal((await discoverTestSymbols(conditional)).methods.length, 0);
  const enabled = await discoverTestSymbols(conditional, {preprocessorSymbols: ['FEATURE']});
  assert.deepEqual(enabled.methods.map(value => value.fqn), ['Enabled.Present']);
});

test('A23 T35 semantic attribute hooks resolve aliases and preserve unresolved values explicitly', async () => {
  const input = 'class Tests { [Alias(Answer)] public void Case() { } }';
  const unresolved = await discoverTestSymbols(input);
  assert.deepEqual(unresolved.methods[0].attributes[0].arguments, [{kind: 'unresolved', expression: 'Answer'}]);
  const resolved = await discoverTestSymbols(input, {
    resolveAttributeType: () => 'Example.CaseAttribute',
    resolveConstant: node => node.toString() === 'Answer' ? {hasValue: true, value: 42} : {hasValue: false}
  });
  assert.equal(resolved.methods[0].attributes[0].type, 'Example.CaseAttribute');
  assert.deepEqual(resolved.methods[0].attributes[0].arguments, [42]);
});

test('A23 T35 malformed syntax reports diagnostics and collection, method and source limits reject', async () => {
  const invalid = await discoverTestSymbols('class Tests { public void Case( }');
  assert.ok(invalid.diagnostics.some(value => value.severity === 'error'));
  await assert.rejects(discoverTestSymbols({}), /source collection/);
  await assert.rejects(discoverTestSymbols(Array(10001).fill({uri: 'Empty.cs', text: ''})), /source collection/);
  await assert.rejects(discoverTestSymbols([{uri: 'Large.cs', text: ' '.repeat(4000001)}]), /source size limit/);
  await assert.rejects(discoverTestSymbols(source, {maxMethods: 1}), /method count limit/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(discoverTestSymbols(source, {signal: controller.signal}), {name: 'AbortError'});
});
