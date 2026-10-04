import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedStackBound} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {invokeManagedMethod} from '../packages/runtime/src/execution/synchronous-call.js';
import {controlFixture} from './support/control-fixture.js';

function assembly() {
  return controlFixture([{name: 'Program', methods: [
    {name: 'Main', body: writer => writer.op('ret')},
    {name: 'Callback', result: 'int', body(writer) {
      writer.mark('try').op('nop').op('leave', 'done');
      writer.mark('finally').op('nop').op('endfinally');
      writer.mark('done').op('ldc.i4', 42).op('ret');
    }, handlers: labels => [{flags: 2, start: labels.get('try'), end: labels.get('finally'),
      target: labels.get('finally'), handlerEnd: labels.get('done')}]}
  ]}]);
}

function callbackToken(vm) {
  const method = vm.inspector.types.find(type => type.name === 'Program').methods.find(method => method.name === 'Callback');
  assert.equal(vm.report.methods.includes(method.token), false, 'callback must require fresh reachability verification');
  return method.token;
}

for (const [name, options] of [
  ['nested', {assemblyLimits: {maxMethods: 1}}],
  ['legacy', {maxMethods: 1}],
  ['nested override', {maxMethods: 3, assemblyLimits: {maxMethods: 1}}],
]) {
  test(`${name} method-count limit rejects a new callback root before changing execution or the original proof`, () => {
    const vm = new CilVirtualMachine(assembly(), options);
    const callback = callbackToken(vm);
    const report = vm.report;
    const caller = vm.top;
    const proof = verifiedStackBound(vm.inspector, report, caller.method);
    const frames = vm.frames;
    vm.state = 'paused';
    try {
      assert.throws(() => invokeManagedMethod(vm.platform, callback, null, []), /verification roots exceed the method limit/);
      assert.equal(vm.report, report);
      assert.equal(verifiedStackBound(vm.inspector, report, caller.method), proof);
      assert.equal(vm.top, caller);
      assert.equal(vm.frames, frames);
      assert.equal(vm.instructions, 0);
      assert.equal(vm.state, 'paused');
      assert.equal(vm.scheduler.callbackScopes?.length ?? 0, 0);
    } finally { vm.stop(); }
  });
}

test('a callback with EH uses explicit structural limits without importing the enclosing execution quota', () => {
  const vm = new CilVirtualMachine(assembly(), {maxBytes: 256, maxInstructions: 20_000_000,
    assemblyLimits: {maxMethods: 2, maxInstructions: 32}});
  const callback = callbackToken(vm);
  const caller = vm.top;
  vm.state = 'paused';
  try {
    assert.equal(invokeManagedMethod(vm.platform, callback, null, []), 42);
    assert.equal(vm.report.methods.length, 2);
    assert(vm.report.methods.includes(callback));
    assert.equal(vm.top, caller);
    assert.equal(vm.state, 'paused');
    assert.equal(vm.heap.maxBytes, 256);
    assert.equal(vm.options.maxInstructions, 20_000_000);
    assert.equal(vm.scheduler.callbackScopes.length, 0);
    assert.equal(vm.instructions, 6);
  } finally { vm.stop(); }
});

test('a callback structural allowance cannot raise the enclosing runtime instruction budget', () => {
  const vm = new CilVirtualMachine(assembly(), {maxInstructions: 1, assemblyLimits: {maxMethods: 2, maxInstructions: 32}});
  const callback = callbackToken(vm);
  const caller = vm.top;
  vm.state = 'paused';
  try {
    assert.throws(() => invokeManagedMethod(vm.platform, callback, null, []), {name: 'InstructionLimitException'});
    assert.equal(vm.report.methods.length, 2, 'structural admission succeeded before the runtime quota tripped');
    assert.equal(vm.instructions, 2);
    assert.equal(vm.options.maxInstructions, 1);
    assert.equal(vm.top, caller);
    assert.equal(vm.state, 'paused');
    assert.equal(vm.scheduler.callbackScopes.length, 0);
  } finally { vm.stop(); }
});
