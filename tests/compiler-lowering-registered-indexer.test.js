import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {parse} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {analyze} from '../packages/compiler/src/semantic-analysis.js';
import {walk} from '../packages/compiler/src/bound/semantic-walker.js';

function fixture() {
  const types = new Map();
  const contracts = [];
  const add = (owner, name, parameters, result) => contracts.push({
    id: contracts.length, owner, name, parameters, result, kind: 'method', isStatic: false
  });
  for (const [owner, defaultMember, element, readOnly] of [
    ['Fixture.Named', 'Chars', 'char', false], ['Fixture.Other', 'Tokens', 'int', false],
    ['Fixture.Legacy', undefined, 'int', false], ['Fixture.ReadOnly', 'Chars', 'char', true],
    ['Fixture.Bag`1<object>', 'Values', 'object', false], ['Fixture.Bag`1<string>', 'Values', 'string', false]
  ]) {
    types.set(owner, {name: owner, kind: 'bcl', base: 'object', properties: {}, events: {},
      ...(defaultMember === undefined ? {} : {defaultMember})});
    const name = defaultMember ?? 'Item';
    add(owner, 'get_' + name, ['int'], element);
    if (!readOnly) add(owner, 'set_' + name, ['int', element], 'void');
    if (defaultMember) add(owner, 'get_Item', ['int'], 'bool');
  }
  const bridge = new RegistryBridge({types, contracts, builtins: []});
  return {types, contracts, bridge};
}

test('Registered indexers: optional defaultMember selects native accessor names and preserves Item fallback', () => {
  const {bridge} = fixture();
  for (const [owner, name, result] of [
    ['Fixture.Named', 'Chars', 'char'], ['Fixture.Other', 'Tokens', 'int'], ['Fixture.Legacy', 'Item', 'int']
  ]) {
    const members = bridge.typeFromName(owner).getMembers('this[]');
    assert.equal(members.length, 1, owner);
    assert.equal(members[0].getMethod.name, 'get_' + name);
    assert.equal(members[0].setMethod.name, 'set_' + name);
    assert.equal(members[0].type.toDisplayString(), result);
  }
  const readOnly = bridge.typeFromName('Fixture.ReadOnly').getMembers('this[]')[0];
  assert.equal(readOnly.getMethod.name, 'get_Chars');
  assert.equal(readOnly.setMethod, null);
});

test('Registered indexers: semantic binding uses named getter/setter contracts without Item aliases', () => {
  const {bridge} = fixture();
  const source = `class Program {
    static char Read(Fixture.Named value) { return value[1]; }
    static void Write(Fixture.Named value) { value[2] = 'x'; }
  }`;
  const analysis = analyze([parse(new SourceText(source, 'NamedIndexer.cs'))], {bridge});
  assert.deepEqual(analysis.diagnostics.filter(row => row.severity === 'error'), []);
  const accesses = [];
  for (const body of analysis.bound.values()) walk(body, node => {
    if (node.kind === 'IndexerAccess') accesses.push(node);
  });
  assert.equal(accesses.length, 2);
  for (const access of accesses) {
    assert.equal(access.property.getMethod.contract.name, 'get_Chars');
    assert.equal(access.property.setMethod.contract.name, 'set_Chars');
  }
});

test('Registered indexers: open generic member synthesis retains the registered default name', () => {
  const {bridge} = fixture();
  const type = bridge.typeFromName('Fixture.Bag`1<object>');
  const definition = type.originalDefinition;
  const indexers = definition.getMembers('this[]');
  assert.equal(indexers.length, 1);
  assert.equal(indexers[0].getMethod.name, 'get_Values');
  assert.equal(indexers[0].setMethod.name, 'set_Values');
  assert(indexers[0].type === definition.typeParameters[0]);
});

test('Registered indexers: read-only metadata still rejects source assignment', () => {
  const {bridge} = fixture();
  const analysis = analyze([parse(new SourceText(
    "class Program { static void Write(Fixture.ReadOnly value) { value[0] = 'x'; } }", 'ReadOnlyIndexer.cs'))], {bridge});
  assert(analysis.diagnostics.some(row => row.code === 'CS0200'), JSON.stringify(analysis.diagnostics));
});

const controlSource = `using System; using System.Collections.Generic;
class Program {
  static List<int> values = new List<int>();
  static int receivers; static int indices;
  static List<int> Target() { receivers++; return values; }
  static int Key() { indices++; return 0; }
  static void Main() {
    values.Add(3); Target()[Key()] = 7; values[0] += 2;
    Console.WriteLine(values[0]); Console.WriteLine(receivers); Console.WriteLine(indices);
    var map = new Dictionary<string, int>(); map["x"] = 5; map["x"]++;
    Console.WriteLine(map["x"]); Console.WriteLine("abc"[1]);
  }
}`;

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`Registered indexers ${pipeline}/${engine}: released Item and string reads/writes retain evaluation order`, () => {
      const program = compileToIL(controlSource, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, '9\n1\n1\n6\nb\n');
      } finally {vm.stop();}
    });
  }
}
