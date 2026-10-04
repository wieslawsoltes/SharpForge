import test from 'node:test';
import assert from 'node:assert/strict';
import {BuiltinMap, Builtins} from '@sharpforge/bytecode';
import {ManagedHeap, VirtualMachine} from '@sharpforge/runtime';
import {ManagedFault} from '../packages/runtime/src/heap.js';
import {SUSPENDED} from '../packages/runtime/src/platform.js';
import {builtin} from '../packages/runtime/src/execution/source-builtins.js';
import {binary, convert, unary} from '../packages/runtime/src/execution/source-ops.js';
import * as sourceEH from '../packages/runtime/src/execution/source-eh.js';
import {image} from './helpers.js';

// Builtin tests deliberately supply services only: no bytecode image or VM constructor.
function services(options = {}) {
  return {
    heap: new ManagedHeap(options), output: [], outputCharacters: 0,
    options: {maxOutputCharacters: 1000, ...options}, onOutput() {},
    value: VirtualMachine.prototype.value, format: VirtualMachine.prototype.format,
    emitOutput: VirtualMachine.prototype.emitOutput
  };
}
function invoke(vm, name, ...args) { return builtin(vm, BuiltinMap.get(name).id, args); }

test('source builtin seam: numeric overloads and midpoint rounding work without an image', () => {
  const vm = services();
  for (const [name, args, expected] of [
    ['Math.Abs', [-2147483648], 2147483648], ['$Math.Abs.Int32', [-2147483647], 2147483647],
    ['Math.Min', [-4, 3], -4], ['Math.Max', [-4, 3], 3], ['Math.Pow', [2, 4], 16],
    ['Math.Sqrt', [9], 3], ['Math.Floor', [-1.2], -2], ['Math.Ceiling', [-1.2], -1],
    ['Math.Round', [2.5], 2], ['Math.Round', [3.5], 4], ['Math.Round', [-1.5], -2],
    ['Convert.ToInt32', [2.5], 2], ['Convert.ToInt32', [-1.5], -2],
    ['Convert.ToInt32', [2147483647], 2147483647], ['Convert.ToInt32', [-2147483648], -2147483648]
  ]) assert.equal(invoke(vm, name, ...args), expected, name);
  for (const [name, value] of [['$Math.Abs.Int32', -2147483648], ['Convert.ToInt32', 2147483648], ['Convert.ToInt32', NaN], ['Convert.ToInt32', Infinity]]) {
    assert.throws(() => invoke(vm, name, value), {name: 'OverflowException'});
  }
});

test('source builtin seam: parsing preserves range and format failures', () => {
  const vm = services(), text = value => vm.heap.string(value);
  assert.equal(invoke(vm, 'int.Parse', text(' +2147483647 ')), 2147483647);
  assert.equal(invoke(vm, 'int.Parse', text('-2147483648')), -2147483648);
  assert.equal(invoke(vm, 'double.Parse', text(' -.5e2 ')), -50);
  assert.equal(invoke(vm, 'Convert.ToDouble', text('1.25')), 1.25);
  for (const value of ['2147483648', '-2147483649']) assert.throws(() => invoke(vm, 'int.Parse', text(value)), {name: 'OverflowException'});
  for (const value of ['', '1.2', '1x']) assert.throws(() => invoke(vm, 'int.Parse', text(value)), {name: 'FormatException'});
  assert.throws(() => invoke(vm, 'double.Parse', text('1e')), {name: 'FormatException'});
  assert.throws(() => invoke(vm, 'Convert.ToDouble', text('bad')), {name: 'FormatException'});
});

test('source builtin seam: output formatting, callbacks, and output limits are retained', () => {
  const vm = services({maxOutputCharacters: 7}), writes = [];
  vm.onOutput = text => writes.push(text);
  invoke(vm, 'Console.WriteLine', true);
  invoke(vm, 'Console.WriteLine');
  invoke(vm, 'Console.Write', 7);
  assert.deepEqual(writes, ['True\n', '\n', '7']);
  assert.equal(vm.outputCharacters, 7);
  assert.throws(() => invoke(vm, 'Console.Write', 'x'), {name: 'OutputLimitException'});
  assert.equal(vm.output.join(''), 'True\n\n7');
});

test('source builtin seam: strings preserve empty, null, and endpoint behavior', () => {
  const vm = services(), text = vm.heap.string('abc');
  assert.equal(vm.value(invoke(vm, 'string.Substring', text, 3, 0)), '');
  assert.equal(vm.value(invoke(vm, 'string.Substring', text, 1)), 'bc');
  assert.equal(invoke(vm, 'string.Contains', text, vm.heap.string('b')), true);
  assert.equal(invoke(vm, 'string.IndexOf', text, vm.heap.string('z')), -1);
  assert.equal(invoke(vm, 'string.IsNullOrEmpty', null), true);
  assert.equal(invoke(vm, 'string.IsNullOrEmpty', vm.heap.string('')), true);
  assert.equal(vm.value(invoke(vm, 'string.Replace', text, vm.heap.string('b'), null)), 'ac');
  assert.equal(vm.value(invoke(vm, 'string.ToUpper', text)), 'ABC');
  assert.throws(() => invoke(vm, 'string.Substring', text, 3, 1), {name: 'ArgumentOutOfRangeException'});
  assert.throws(() => invoke(vm, 'string.Substring', text, -1), {name: 'ArgumentOutOfRangeException'});
  assert.throws(() => invoke(vm, 'string.Substring', null, 0), {name: 'NullReferenceException'});
  assert.throws(() => invoke(vm, 'string.Contains', text, null), {name: 'ArgumentNullException'});
  assert.throws(() => invoke(vm, 'string.Replace', text, vm.heap.string(''), null), {name: 'ArgumentException'});
});

test('source builtin seam: allocating intrinsics pin their arguments through collection', () => {
  const vm = services(), a = vm.heap.string('first'), b = vm.heap.string('second');
  vm.heap.threshold = vm.heap.stats.liveBytes;
  const result = invoke(vm, 'string.Concat', a, b);
  assert(vm.heap.stats.collections > 0);
  assert.equal(vm.value(result), 'firstsecond');
  assert.equal(vm.value(a), 'first');
  assert.equal(vm.value(b), 'second');
  assert.equal(vm.heap.pins.length, 0);
});

test('source builtin seam: GC, arrays, and managed exception values preserve behavior', () => {
  const vm = services(), array = vm.heap.array('int', 3);
  vm.heap.get(array).data = [10, -1, 2];
  invoke(vm, 'Array.Sort', array);
  assert.deepEqual(vm.heap.get(array).data, [-1, 2, 10]);
  invoke(vm, 'Array.Reverse', array);
  assert.deepEqual(vm.heap.get(array).data, [10, 2, -1]);
  assert.throws(() => invoke(vm, 'Array.Sort', vm.heap.string('abc')), {name: 'ArgumentException'});
  const message = vm.heap.string('failure'), fault = invoke(vm, 'Exception.new', message);
  assert.equal(invoke(vm, 'Exception.Message', fault), message);
  assert.throws(() => invoke(vm, 'Debug.Assert', false, message), {name: 'AssertionException', message: 'failure'});
  assert.equal(vm.heap.pins.length, 0);
  invoke(vm, 'GC.Collect');
  assert.equal(String(invoke(vm, 'GC.GetTotalMemory', true)), '0');
  assert.equal(invoke(vm, 'GC.CollectionCount', 0), 2);
  assert.throws(() => invoke(vm, 'GC.CollectionCount', 3), {name: 'ArgumentOutOfRangeException'});
});

test('source builtin seam: framework delegation preserves contract, arguments, and suspension', () => {
  const entry = Builtins.find(entry => entry.contract), args = [1, 2];
  const vm = {platform: {invoke(contract, actual) {
    assert.equal(contract, entry.contract);
    assert.equal(actual, args);
    return SUSPENDED;
  }}};
  assert.equal(builtin(vm, entry.id, args), SUSPENDED);
});

test('source operation seam: numeric modes preserve overflow, division, and shifts', () => {
  const vm = services();
  assert.equal(binary(vm, '+', 2147483647, 1, 1), -2147483648);
  assert.equal(binary(vm, '*', 1073741824, 4, 1), 0);
  assert.equal(binary(vm, '/', -7, 2, 1), -3);
  assert.equal(binary(vm, '/', 1, 0), Infinity);
  assert.equal(binary(vm, '%', -7, 2, 1), -1);
  assert.equal(binary(vm, '<<', 1, 33, 1), 2);
  assert.equal(binary(vm, '>>', -8, 33, 1), -4);
  assert.equal(binary(vm, '^', true, false, 3), true);
  assert.equal(binary(vm, '+', 2147483646, 1, 5), 2147483647);
  for (const [operator, a, b] of [['+', 2147483647, 1], ['-', -2147483648, 1], ['*', 1073741824, 2]]) {
    assert.throws(() => binary(vm, operator, a, b, 5), {name: 'OverflowException'});
  }
  assert.throws(() => binary(vm, '/', -2147483648, -1, 1), {name: 'OverflowException'});
  for (const operator of ['/', '%']) assert.throws(() => binary(vm, operator, 1, 0, 1), {name: 'DivideByZeroException'});
  assert.throws(() => binary(vm, 'unknown', 1, 2), {name: 'InvalidProgramException'});
});

test('source operation seam: strings compare by value and object handles include generations', () => {
  const vm = services(), a = vm.heap.string('equal'), b = vm.heap.string('equal');
  assert.equal(binary(vm, '==', a, b), true);
  assert.equal(vm.value(binary(vm, '+', a, true, 2)), 'equalTrue');
  const identity = {value: value => value};
  assert.equal(binary(identity, '==', {h: 1, g: 1}, {h: 1, g: 1}), true);
  assert.equal(binary(identity, '==', {h: 1, g: 1}, {h: 1, g: 2}), false);
  assert.equal(binary(identity, '!=', {h: 1, g: 1}, {h: 2, g: 1}), true);
});

test('source operation seam: conversion and unary boundaries preserve checked behavior', () => {
  assert.equal(convert(7.9, 0), 7);
  assert.equal(convert(-7.9, 0), -7);
  for (const [value, expected] of [[NaN, 0], [Infinity, 2147483647], [-Infinity, -2147483648], [2147483648, 2147483647], [-2147483649, -2147483648]]) {
    assert.equal(convert(value, 0), expected);
    assert.throws(() => convert(value, 0, 1), {name: 'OverflowException'});
  }
  assert.equal(convert(2147483647.9, 0, 1), 2147483647);
  assert.equal(convert(-2147483648, 0, 1), -2147483648);
  assert.equal(convert(7, 1), 7);
  assert.equal(unary('-', -2147483648, 1), -2147483648);
  assert.throws(() => unary('-', -2147483648, 5), {name: 'OverflowException'});
  assert.equal(unary('-', -2147483647, 5), 2147483647);
  assert.equal(unary('-', 1.5), -1.5);
  assert.equal(unary('!', false), true);
  assert.equal(unary('~', 0), -1);
  assert.equal(unary('+', -5), -5);
});

function exceptionContext(handlers = []) {
  const frame = {id: 1, methodId: 0, pc: 6, base: 0, locals: [], point: null, ...sourceEH.frameState()};
  const vm = Object.assign(Object.create(VirtualMachine.prototype), {
    heap: new ManagedHeap(), image: {methods: [{qualifiedName: 'Test.Main', code: new Int32Array(120), handlers}]},
    frames: [frame], stack: [], state: 'running', fault: null, pendingFault: null,
    platform: {singletons: new Map()}, scheduler: {current: null}, options: {}
  });
  vm.heap.rootProvider = () => sourceEH.roots(vm);
  return {vm, frame};
}

test('source EH seam: nested return finalizers retain values until the outer cleanup finishes', () => {
  const outer = {kind: 'finally', start: 0, end: 10, target: 20, handlerEnd: 25};
  const inner = {kind: 'finally', start: 3, end: 8, target: 12, handlerEnd: 15};
  const {vm, frame} = exceptionContext([outer, inner]), result = vm.heap.object('Result', [42]);
  vm.stack.push('temporary');
  vm.transfer(frame, 'return', Infinity, result);
  assert.equal(frame.pc, 12);
  assert.deepEqual(vm.stack, []);
  vm.heap.collect();
  assert.equal(vm.heap.get(result).data[0], 42);
  vm.resumeUnwind(frame);
  assert.equal(frame.pc, 20);
  vm.resumeUnwind(frame);
  assert.equal(vm.state, 'terminated');
  assert.equal(vm.returnValue, result);
  assert.equal(vm.frames.length, 0);
});

test('source EH seam: jumps within a protected region skip cleanup and exiting jumps resume once', () => {
  const handler = {kind: 'finally', start: 0, end: 10, target: 12, handlerEnd: 15};
  const {vm, frame} = exceptionContext([handler]);
  vm.transfer(frame, 'jump', 8);
  assert.equal(frame.pc, 8);
  assert.equal(frame.unwinds.length, 0);
  vm.transfer(frame, 'jump', 20);
  assert.equal(frame.pc, 12);
  vm.resumeUnwind(frame);
  assert.equal(frame.pc, 20);
  assert.equal(frame.unwinds.length, 0);
  assert.throws(() => vm.resumeUnwind(frame), {name: 'InvalidProgramException'});
});

test('source EH seam: faults cross cleanup before entering a catch and retain managed roots', () => {
  const catcher = {kind: 'catch', start: 0, end: 25, target: 28, slot: 0};
  const cleanup = {kind: 'finally', start: 0, end: 10, target: 12, handlerEnd: 15};
  const {vm, frame} = exceptionContext([catcher, cleanup]);
  vm.image.methods[0].code[catcher.end * 3 + 1] = 35;
  const fault = new ManagedFault('Exception', 'original');
  vm.handleFault(fault);
  assert.equal(frame.pc, 12);
  assert.equal(vm.fault, null);
  vm.heap.collect();
  assert.equal(vm.heap.get(fault.reference).methodTable.name, 'System.Exception');
  vm.resumeUnwind(frame);
  assert.equal(frame.pc, 28);
  assert.equal(frame.locals[0], fault.reference);
  assert.equal(frame.exception, fault);
  frame.pc = 29;
  assert.throws(() => sourceEH.rethrow(frame), error => error === fault);
  frame.pc = 36;
  assert.throws(() => sourceEH.rethrow(frame), {name: 'InvalidOperationException'});
});

test('source EH seam: pending, caught, and active fault references survive collection', () => {
  const {vm, frame} = exceptionContext();
  const make = message => new ManagedFault('Exception', message, vm.heap.allocate('exception', 'Exception', [vm.heap.string(message)]));
  vm.pendingFault = make('pending');
  vm.fault = make('active');
  frame.exception = make('frame');
  frame.caught.push({start: 0, end: 10, fault: make('caught')});
  const refs = [vm.pendingFault.reference, vm.fault.reference, frame.exception.reference, frame.caught[0].fault.reference];
  vm.heap.collect();
  for (const ref of refs) assert.equal(vm.heap.get(ref).kind, 'exception');
});

test('source EH seam: unhandled allocation failures preserve the original managed fault', () => {
  const {vm} = exceptionContext(), fault = new ManagedFault('OutOfMemoryException', 'original');
  vm.heap.string = () => { throw new Error('secondary'); };
  vm.handleFault(fault);
  assert.equal(vm.state, 'faulted');
  assert.equal(vm.fault, fault);
  assert.deepEqual(fault.frames, [{method: 'Test.Main', methodId: 0, instruction: 5, point: null}]);
  assert.equal(vm.frames.length, 1, 'The original throwing frame remains inspectable');
  assert.equal(fault.fatal, true);
});

test('source VM dispatch uses extracted operations while return and rethrow cleanup remain ordered', () => {
  const vm = new VirtualMachine(image(`
    int F() { try { return checked((int)3.9 + -1); } finally { Console.WriteLine("cleanup"); } }
    Console.WriteLine(F());
    try { try { throw new Exception("outer"); } catch(Exception e) {
      try { throw new Exception("inner"); } catch(Exception f) { Console.WriteLine(f.Message); }
      throw;
    } } catch(Exception e) { Console.WriteLine(e.Message); }
  `));
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, 'cleanup\n2\ninner\nouter\n');
});
