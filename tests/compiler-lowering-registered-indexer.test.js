import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {parse} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {analyze} from '../packages/compiler/src/semantic-analysis.js';
import {walk} from '../packages/compiler/src/bound/semantic-walker.js';
import {registeredIndexerName} from '../packages/compiler/src/symbols/registry-indexers.js';
import {registeredIndexerContract, prepareRegisteredIndexer} from '../packages/compiler/src/framework-indexers.js';
import {FrameworkCompiler} from '../packages/compiler/src/framework.js';

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
  const resolver = {
    types, frameworkType: type => types.get(type),
    findContracts(type, name, isStatic) {
      const results = [];
      for (let owner = type; owner; owner = types.get(owner)?.base) {
        results.push(...contracts.filter(row => row.owner === owner && row.name === name && row.isStatic === isStatic));
      }
      return results;
    }
  };
  return {types, contracts, bridge, resolver};
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

test('Registered indexers: the metadata name is typed, inherited and has one Item fallback', () => {
  const {types, resolver} = fixture();
  types.set('Fixture.Child', {name: 'Fixture.Child', base: 'Fixture.Named'});
  assert.equal(registeredIndexerName(types.get('Fixture.Child'), types), 'Chars');
  assert.equal(registeredIndexerContract('Fixture.Child', 'get', resolver).name, 'get_Chars');
  assert.equal(registeredIndexerName(undefined, types), 'Item');
  for (const defaultMember of ['', null, 7, false]) {
    assert.throws(() => registeredIndexerName({defaultMember}, types),
      {name: 'TypeError', message: 'Registered defaultMember must be a nonempty string'});
  }
  types.set('Fixture.Cycle', {base: 'Fixture.Cycle'});
  assert.equal(registeredIndexerName(types.get('Fixture.Cycle'), types), 'Item', 'Malformed fixture bases cannot hang lookup');
});

function legacyFrame(owner) {
  const compiler = new (FrameworkCompiler(class {}))();
  const events = [];
  let slot = 0;
  Object.assign(compiler, {
    c: {report: (_node, code) => events.push(['diagnostic', code])},
    infer: () => owner,
    expr: node => { events.push(['expression', node.name]); return node.type; },
    temp: type => { events.push(['temporary', type]); return slot++; },
    emit: (...args) => events.push(['emit', ...args]),
    checkAssign: (expected, actual) => assert.equal(actual, expected),
    emitContract: contract => { events.push(['contract', contract.name]); return contract.result; },
    clear: value => events.push(['clear', value])
  });
  return {compiler, events};
}

test('Registered indexers: legacy preparation and load/store emit the metadata-selected native contracts', () => {
  const {resolver} = fixture();
  for (const [owner, name, valueType] of [
    ['Fixture.Named', 'Chars', 'char'], ['Fixture.Other', 'Tokens', 'int'], ['Fixture.Legacy', 'Item', 'int']
  ]) {
    const {compiler, events} = legacyFrame(owner);
    const node = {kind: 'Index', target: {name: 'receiver', type: owner}, index: {name: 'key', type: 'int'}};
    const reference = prepareRegisteredIndexer(compiler, node, resolver);
    assert.equal(reference.type, valueType);
    compiler.loadFramework(reference);
    compiler.storeFramework(reference);
    assert.deepEqual(events.filter(row => row[0] === 'expression'), [['expression', 'receiver'], ['expression', 'key']]);
    assert.deepEqual(events.filter(row => row[0] === 'contract'), [['contract', 'get_' + name], ['contract', 'set_' + name]]);
    assert.equal(events.filter(row => row[0] === 'diagnostic').length, 0);
  }
});

test('Registered indexers: legacy preparation preserves read-only and missing-indexer boundaries', () => {
  const {resolver} = fixture();
  const {compiler, events} = legacyFrame('Fixture.ReadOnly');
  const node = {kind: 'Index', target: {name: 'receiver', type: 'Fixture.ReadOnly'}, index: {name: 'key', type: 'int'}};
  const reference = prepareRegisteredIndexer(compiler, node, resolver);
  assert.equal(reference.property.get.name, 'get_Chars');
  assert.equal(reference.property.set, undefined);
  assert.deepEqual(events.filter(row => row[0] === 'diagnostic'), [['diagnostic', 'CS0200']]);
  const missing = legacyFrame('Fixture.Missing');
  assert.equal(prepareRegisteredIndexer(missing.compiler, node, resolver), null);
  assert.equal(missing.events.length, 0);
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
