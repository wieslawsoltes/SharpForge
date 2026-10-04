import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL, compileToAssembly} from '@sharpforge/compiler';
import {AssemblyInspector, loadAssembly, emitAssembly, readSourceTypeIdentities, codedIndex} from '@sharpforge/cil';
import {copySourceTypeIdentity, sourceTypeIdentities, serializeImage, deserializeImage, verifyImage} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {runtimeTypeObject, runtimeTypeText, typeName, typeProperty} from '../packages/runtime/src/execution/tokens.js';
import {controlFixture} from './support/control-fixture.js';

const source = `using System;
  namespace Sample {
    struct Cell<T> { public T Value; }
    class Box<T> { public T Value; }
    class Outer<T> { public class Inner<U> { } }
  }
  class Program { static void Main() {
    var value = new Sample.Cell<int>(); value.Value = 17; object boxed = value;
    Console.WriteLine(boxed); Console.WriteLine(boxed.GetType().Name);
    Console.WriteLine(((Sample.Cell<int>)boxed).Value);
    object text = new Sample.Cell<string>(); Console.WriteLine(text.GetType().Name);
    Console.WriteLine(boxed.GetType() == text.GetType());
    var item = new Sample.Box<int>(); Console.WriteLine(item); Console.WriteLine(item.ToString());
    Console.WriteLine("box:" + item); Console.WriteLine($"value:{item}");
    object nested = new Sample.Outer<int>.Inner<string>(); Console.WriteLine(nested);
    object arrays = new Sample.Box<int[,]>(); Console.WriteLine(arrays);
  } }`;

const expected = 'Sample.Cell`1[System.Int32]\nCell`1\n17\nCell`1\nFalse\n' +
  'Sample.Box`1[System.Int32]\nSample.Box`1[System.Int32]\nbox:Sample.Box`1[System.Int32]\n' +
  'value:Sample.Box`1[System.Int32]\nSample.Outer`1+Inner`1[System.Int32,System.String]\nSample.Box`1[System.Int32[,]]\n';

function artifact() {
  const result = compileToIL(source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

test('logical generic names preserve boxing, distinct type identities and formatting in all source routes', () => {
  const result = artifact();
  for (const vm of [new VirtualMachine(result.image), new VirtualMachine(loadAssembly(result.assembly)),
    new CilVirtualMachine(result.assembly), new CilVirtualMachine(emitAssembly(result.image, {includeDebug: false}))]) {
    const outcome = vm.run();
    assert.equal(outcome.state, 'terminated', outcome.fault?.stack);
    assert.equal(outcome.output, expected);
    const table = vm.heap.methodTables.get('Sample.Cell{int}');
    assert.equal(table.name, 'Sample.Cell{int}', 'Physical layout/dispatch key is unchanged');
    assert.equal(table.genericDefinition, null, 'The physical monomorphized type has no open CLI generic definition');
    const type = runtimeTypeObject(vm, table);
    assert.equal(typeName(vm, type), 'Cell`1');
    assert.equal(typeName(vm, type, true), 'Sample.Cell`1[[System.Int32, System.Private.CoreLib, Version=8.0.0.0, ' +
      'Culture=neutral, PublicKeyToken=7cec85d7bea7798e]]');
    assert.equal(typeProperty(vm, type, 'IsGenericType'), true);
    assert.equal(typeProperty(vm, type, 'IsGenericTypeDefinition'), false);
    assert.equal(typeProperty(vm, type, 'ContainsGenericParameters'), false);
    vm.stop();
  }
});

test('source identity descriptors roundtrip as owned immutable data, including debug-stripped CIL', () => {
  const result = artifact();
  const image = deserializeImage(serializeImage(result.image));
  const identities = sourceTypeIdentities(image.types);
  const cell = identities.get('Sample.Cell{int}');
  assert(Object.isFrozen(cell) && Object.isFrozen(cell.arguments) && Object.isFrozen(cell.arguments[0]));
  assert.notEqual(cell, image.types.find(type => type.name === 'Sample.Cell{int}').sourceIdentity);
  for (const includeDebug of [true, false]) {
    const inspector = new AssemblyInspector(emitAssembly(image, {includeDebug}));
    const recovered = readSourceTypeIdentities(inspector.metadata);
    assert.equal(recovered.size, identities.size);
    const token = inspector.types.find(type => type.name === 'Sample.Cell{int}').token;
    assert.deepEqual(recovered.get(token), cell);
    assert.equal(inspector.signature(inspector.types.find(type => type.name === 'Sample.Cell{int}').fields[0].token).type, 'int');
  }
});

test('boxing through a substituted method parameter uses the closed struct storage category', () => {
  const artifact = compileToIL(`using System;
    struct Cell<T> { public T Value; }
    class Program {
      static object Box<T>(T value) { return value; }
      static void Main() {
        var value = new Cell<int>(); value.Value = 29;
        object boxed = Box(value); value.Value = 31;
        Console.WriteLine(boxed); Console.WriteLine(((Cell<int>)boxed).Value);
        Console.WriteLine(value.Value);
      }
    }`);
  assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
  for (const vm of [new VirtualMachine(artifact.image), new VirtualMachine(loadAssembly(artifact.assembly)),
    new CilVirtualMachine(artifact.assembly)]) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, 'Cell`1[System.Int32]\n29\n31\n');
    vm.stop();
  }
});

test('malformed, cyclic, overdeep and colliding logical descriptors fail source admission', () => {
  const identity = {name: 'Cell`1', assembly: 'source', arguments: [{name: 'System.Int32', assembly: 'core', arguments: []}]};
  assert.throws(() => copySourceTypeIdentity({...identity, arguments: []}), /identity/);
  assert.throws(() => copySourceTypeIdentity({...identity, injected: true}), /identity/);
  assert.throws(() => copySourceTypeIdentity({...identity, name: 'Cell`1[System.Int32]'}), /identity/);
  const cyclic = {...identity}; cyclic.arguments = [cyclic];
  assert.throws(() => copySourceTypeIdentity(cyclic), /identity/);
  assert.throws(() => sourceTypeIdentities([{name: 'One', sourceIdentity: identity}, {name: 'Two', sourceIdentity: identity}]), /Duplicate/);
  assert.throws(() => sourceTypeIdentities([{name: 'Cell`1'}, {name: 'Cell{int}', sourceIdentity: identity}]), /identity/);
  const image = deserializeImage(serializeImage(artifact().image));
  image.types.find(type => type.sourceIdentity).sourceIdentity = {...identity, assembly: 'foreign'};
  assert(verifyImage(image).some(message => message.includes('Invalid source type identity')));
  assert.throws(() => new VirtualMachine(image), /identity/);
});

test('independent real CLI generic metadata retains its actual definition and type arguments', () => {
  const bytes = controlFixture([
    {name: 'Cell`1', flags: 0x100109, base: 'System.ValueType', genericParameters: [{name: 'T'}],
      fields: [{name: 'Value', type: '!0', flags: 6}], methods: []},
    {name: 'Program', methods: [{name: 'Main', body: writer => writer.op('ret')}]}
  ]);
  const vm = new CilVirtualMachine(bytes);
  const table = vm.typeSystem.table('Cell`1<int>');
  assert.equal(table.sourceIdentity, null);
  assert.equal(table.genericDefinition.name, 'Cell`1');
  assert.equal(table.typeArguments[0].name, 'System.Int32');
  assert.equal(runtimeTypeText(vm, runtimeTypeObject(vm, table)), 'Cell`1[System.Int32]');
  assert.equal(readSourceTypeIdentities(vm.inspector.metadata).size, 0);
  assert.equal(vm.inspector.metadata.rows[42][0][2], codedIndex('TypeOrMethodDef', table.genericDefinition.token));
  const identity = {name: 'Other`1', assembly: 'source', arguments: [{name: 'System.Int32', assembly: 'core', arguments: []}]};
  const malformed = {format: 'SharpForge.TypeIdentity', version: 1,
    types: [{token: table.genericDefinition.token, sourceIdentity: identity}]};
  const streams = new Map(vm.inspector.metadata.streams);
  streams.set('#SF', new TextEncoder().encode(JSON.stringify(malformed)));
  assert.throws(() => readSourceTypeIdentities({...vm.inspector.metadata, streams}), /source type identity token/);
  vm.stop();
});

test('bound-tree native CIL emission retains true generic metadata without source identity projection', () => {
  const artifact = compileToAssembly(`using System;
    struct Cell<T> { public T Value; }
    class Program { static void Main() { object item = new Cell<int>();
      Console.WriteLine(item); Console.WriteLine(item.GetType().Name); } }`);
  assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
  const vm = new CilVirtualMachine(artifact.assembly);
  assert.equal(vm.inspector.types.some(type => type.name === 'Cell`1'), true);
  assert.equal(readSourceTypeIdentities(vm.inspector.metadata).size, 0);
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, 'Cell`1[System.Int32]\nCell`1\n');
  vm.stop();
});
