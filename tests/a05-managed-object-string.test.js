import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {callbackAssembly, objectStringHierarchy, boxedStringOverride} from './fixtures/managed-object-string.js';

const engines = {
  source: (program, options) => new VirtualMachine(program.image, options),
  roundtrip: (program, options) => new VirtualMachine(loadAssembly(program.assembly), options),
  cil: (program, options) => new CilVirtualMachine(program.assembly, options)
};

function program(body, override = 'return "managed";', options = {}) {
  const result = compileToIL(`using System;using System.Text;
    class Value { public int Count; public object Inner; public StringBuilder Builder;
      public override string ToString() { ${override} } }
    class Program { static void Main() { ${body} } }`, options);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

function check(vm, expected) {
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, expected);
  } finally { vm.stop(); }
}


for (const [engine, create] of Object.entries(engines)) {
  for (const text of ['"managed"', '""', 'null']) test(`managed Object.ToString ${engine}: ${text} is returned exactly`, () => {
    const compiled = program('object value = new Value(); Console.WriteLine(value.ToString() == ' + text + ');', `return ${text};`);
    check(create(compiled), 'True\n');
  });

  test(`managed Object.ToString ${engine}: mutation and nested object conversion preserve the live receiver`, () => {
    const compiled = program(`Value outer = new Value(); Value inner = new Value();
      outer.Builder = new StringBuilder("outer"); inner.Builder = new StringBuilder("inner"); outer.Inner = inner;
      object value = outer; Console.WriteLine(value.ToString()); Console.WriteLine(outer.Builder.ToString());
      Console.WriteLine(outer.Count); Console.WriteLine(inner.Count);`,
    'Count++; Builder.Append("!"); if (Inner != null) return Inner.ToString(); return Builder.ToString();');
    check(create(compiled, {initialThreshold: 64}), 'inner!\nouter!\n1\n1\n');
  });

  test(`managed Object.ToString ${engine}: an override fault enters the interrupted managed catch`, () => {
    const compiled = program('object value = new Value(); try { Console.WriteLine(value.ToString()); }' +
      'catch (Exception error) { Console.WriteLine(error.Message); } Console.WriteLine("continued");',
    'throw new Exception("callback failure");');
    check(create(compiled), 'callback failure\ncontinued\n');
  });

  test(`managed Object.ToString ${engine}: plain formatting still uses its released profile`, () => {
    const compiled = program('object value = new Value(); Console.WriteLine(Convert.ToString(value)); Console.WriteLine(value);' +
      'object builder = new StringBuilder("builder"); Console.WriteLine(builder.ToString());' +
      'object uri = new Uri("https://example.com/path"); Console.WriteLine(uri.ToString());' +
      'object number = 42; Console.WriteLine(number.ToString());');
    check(create(compiled), 'Value\nValue\nbuilder\nhttps://example.com/path\n42\n');
  });

  test(`managed Object.ToString ${engine}: infinite callbacks stop at the instruction boundary`, () => {
    const compiled = program('object value = new Value(); new StringBuilder().Insert(0, value);', 'while (true) { Count++; }');
    const vm = create(compiled, {maxSynchronousInstructions: 64});
    try {
      const result = vm.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, 'ExecutionLimitException');
      assert(vm.instructions < 256);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
      assert.equal(vm.scheduler.suppressed, false);
    } finally { vm.stop(); }
  });
}

for (const [options, expected] of [
  [{root: true, leaf: true}, 'leaf override'],
  [{root: true, leaf: false}, 'root override'],
  [{root: true, middle: 'newslot', leaf: true}, 'root override'],
  [{root: false, middle: 'newslot', leaf: true}, 'Leaf'],
  [{root: true, middle: 'hidden', leaf: false}, 'root override'],
  [{root: false, middle: 'hidden', leaf: false}, 'Leaf']
]) test(`managed Object.ToString CIL: actual inherited slots ${JSON.stringify(options)}`, () => {
  const vm = new CilVirtualMachine(objectStringHierarchy(options));
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(vm.value(vm.returnValue), expected);
  } finally { vm.stop(); }
});

test('managed Object.ToString CIL: boxed user struct mutates the existing box', () => {
  const vm = new CilVirtualMachine(boxedStringOverride());
  let receiver;
  vm.onWrite = write => { if (write.kind === 'field' || write.kind === 'box') receiver = vm.top.args[0].owner; };
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(vm.value(vm.returnValue), 'boxed override');
    assert.equal(vm.heap.get(receiver).data[0].fields[0], 1);
  } finally { vm.stop(); }
});

test('managed Object.ToString CIL rejects a structurally admitted non-string runtime result', () => {
  const vm = new CilVirtualMachine(callbackAssembly({invalid: true}));
  try {
    assert.equal(vm.run().state, 'faulted');
    assert.equal(vm.fault.name, 'InvalidProgramException');
  } finally { vm.stop(); }
});
