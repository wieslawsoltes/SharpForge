import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {BuiltinMap, frameworkBuiltin} from '@sharpforge/bytecode';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine, ManagedHeap} from '@sharpforge/runtime';
import {SourceBuiltinResults, sourceValue} from '../packages/runtime/src/execution/source-values.js';
import {enumValue} from '../packages/runtime/src/execution/enums.js';

function compile(source) {
  const compiled = compileToIL(source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return compiled;
}

test('source return classification reads a non-enum contract once and never retains its result', () => {
  let reads = 0;
  const entry = Object.freeze({contract: Object.freeze({get result() { reads++; return 'int'; }})});
  const classification = new SourceBuiltinResults();
  const vm = {heap: new ManagedHeap()};
  for (const value of [0, 42, -1, null, undefined]) assert.equal(classification.convert(vm, entry, value), value);
  assert.equal(reads, 1);
  assert.equal(classification.classifications.get(entry), null);
  const reference = vm.heap.string('not retained');
  assert.equal(classification.convert(vm, entry, reference), reference);
  vm.heap.collect();
  assert.throws(() => vm.heap.get(reference), {name: 'InvalidReferenceException'});
});

test('source return classifications belong to their immutable registry and entry identities', () => {
  const type = 'Microsoft.UI.Xaml.Visibility';
  const enumRegistry = [type];
  const enums = new SourceBuiltinResults(enumRegistry);
  const primitives = new SourceBuiltinResults([]);
  const entry = Object.freeze({id: 1, contract: Object.freeze({result: type})});
  const otherEntry = Object.freeze({id: 1, contract: Object.freeze({result: 'int'})});
  const vm = {heap: new ManagedHeap()};
  enumRegistry.length = 0;
  assert.equal(enums.convert(vm, entry, 1).enumType, type);
  assert.equal(primitives.convert(vm, entry, 1), 1);
  assert.equal(enums.convert(vm, otherEntry, 1), 1);
  assert.equal(enums.convert(vm, entry, 0).value, 0);
  assert.equal(enums.convert(vm, entry, 9).value, 9);
  assert.throws(() => enums.convert(vm, entry, 0.5), {name: 'InvalidProgramException'});
  assert.notEqual(enums.classifications, primitives.classifications);
});

test('source primitive reads avoid object property probes and still validate managed references', () => {
  const heap = new ManagedHeap();
  for (const value of [undefined, null, true, false, 0, -0, 42, NaN, Infinity, 1n, 'host text']) {
    assert.equal(sourceValue(heap, value), value);
  }
  const numberProperty = Object.getOwnPropertyDescriptor(Number.prototype, 'enumType');
  try {
    Object.defineProperty(Number.prototype, 'enumType', {configurable: true, get() { throw new Error('Primitive enum probe'); }});
    assert.equal(sourceValue(heap, 42), 42);
  } finally {
    if (numberProperty) Object.defineProperty(Number.prototype, 'enumType', numberProperty);
    else delete Number.prototype.enumType;
  }
  const text = heap.string('managed');
  const instance = heap.object('Example', []);
  assert.equal(sourceValue(heap, text), 'managed');
  assert.equal(sourceValue(heap, instance), instance);
  assert.equal(sourceValue(heap, enumValue({}, 'Microsoft.UI.Xaml.Visibility', 1)), 1);
  assert.throws(() => sourceValue(heap, {h: 999, g: 1}), {name: 'InvalidReferenceException'});
  heap.collect();
  assert.throws(() => sourceValue(heap, text), {name: 'InvalidReferenceException'});
  assert.throws(() => sourceValue(heap, instance), {name: 'InvalidReferenceException'});
});

for (const engine of ['source', 'cil']) {
  test(`${engine} contract results preserve dictionary values, enum zero and unknown enum values`, () => {
    const compiled = compile(`using Microsoft.UI.Xaml;
      var dictionary = new Dictionary<int,int>();
      dictionary.Add(1, 42);
      dictionary.Add(2, -1);
      Console.WriteLine(dictionary[1]);
      Console.WriteLine(dictionary[2]);
      var element = new Microsoft.UI.Xaml.Controls.Button();
      Console.WriteLine(element.Visibility);
      element.Visibility = Visibility.Collapsed;
      Console.WriteLine(element.Visibility);
      try { element.Visibility = (Visibility)9; }
      catch (Exception error) { Console.WriteLine("rejected"); }
      Console.WriteLine((Visibility)9);
      Console.WriteLine(element.GetType().Name);`);
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, '42\n-1\nVisible\nCollapsed\nrejected\n9\nButton\n');
  });
}

test('source classification caches remain independent and metadata-only across snapshot, restore and stop', () => {
  const compiled = compile('Console.WriteLine(0);');
  const first = new VirtualMachine(compiled.image);
  const second = new VirtualMachine(compiled.image);
  const dictionary = 'System.Collections.Generic.Dictionary`2<int, int>';
  const constructor = frameworkBuiltin(findContracts(dictionary, '.ctor').find(member => member.parameters.length === 0));
  const firstRef = first.builtin(constructor.id, []);
  const secondRef = second.builtin(constructor.id, []);
  const classification = first.builtinResults;
  assert.notEqual(classification, second.builtinResults);
  assert.equal(first.heap.get(firstRef).type, dictionary);
  assert.equal(second.heap.get(secondRef).type, dictionary);
  const snapshot = first.snapshot();
  const stale = first.heap.string('after snapshot');
  first.restore(snapshot);
  assert.equal(first.builtinResults, classification);
  assert.equal(first.value(firstRef), firstRef);
  assert.throws(() => first.value(stale), {name: 'InvalidReferenceException'});
  assert.equal(first.builtin(BuiltinMap.get('Console.WriteLine').id, [42]), null);
  first.stop();
  first.heap.collect();
  assert.throws(() => first.heap.get(firstRef), {name: 'InvalidReferenceException'});
  assert.equal(second.heap.get(secondRef).type, dictionary);
  assert.deepEqual([...classification.classifications.values()], [null]);
});
