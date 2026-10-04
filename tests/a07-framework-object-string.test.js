import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {contracts, findContracts, createRegistry} from '@sharpforge/framework';
import {BuiltinMap} from '@sharpforge/bytecode';
import {AssemblyInspector, intrinsicDefinitions, loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {invokeIntrinsic} from '../packages/runtime/src/execution/intrinsics.js';
import {objectStringInputs, objectStringAssembly, hiddenStringAssembly, primitiveStringAssembly} from './fixtures/object-string.js';

const directory = new URL('../packages/bcl-core/reference/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('object-string-net10.json', directory), 'utf8'));
const engines = {source: program => new VirtualMachine(program.image), cil: program => new CilVirtualMachine(program.assembly)};
const objectString = intrinsicDefinitions.find(entry => entry.implementation === 'objectToString').descriptor;

function compile(source, options = {}) {
  const program = compileToIL('using System;using System.Text;' + source, options);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return program;
}

function member(owner, name, parameters = []) {
  const result = findContracts(owner, name).find(value => value.parameters.join(',') === parameters.join(','));
  assert(result, `${owner}.${name}(${parameters})`);
  return result;
}

function render(vm, engine, value) {
  return engine === 'source' ? vm.builtin(BuiltinMap.get('object.ToString').id, [value]) :
    vm.heap.withRoots([value], () => invokeIntrinsic(vm, objectString, [value], true));
}

test('framework Object.ToString: pinned source hash and exact override opt-ins', () => {
  assert.equal(reference.runtime, '10.0.5');
  const source = readFileSync(new URL('object-string/Program.cs', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), reference.sourceSha256);
  const overrides = contracts.filter(value => value.objectToStringOverride);
  assert.deepEqual(overrides.map(value => value.owner).sort(), ['System.Text.StringBuilder', 'System.Uri']);
  assert.equal(member('System.Text.StringBuilder', 'ToString').id, 812);
  assert.equal(member('System.Uri', 'ToString').id, 1542);
  for (const descriptor of overrides) {
    assert.equal(descriptor.name, 'ToString');
    assert.equal(descriptor.parameters.length, 0);
    assert.equal(descriptor.result, 'string');
    assert.equal(descriptor.isStatic, false);
  }
});

for (const pipeline of ['bound', 'legacy']) {
  test(`framework Object.ToString ${pipeline}: emitted calls and profile round trip keep Convert distinct`, () => {
    const program = compile('object value = new StringBuilder("value");Console.WriteLine(value.ToString());' +
      'Console.WriteLine(Convert.ToString(value));object empty = null;Console.WriteLine(Convert.ToString(empty));', {pipeline});
    const inspector = new AssemblyInspector(program.assembly);
    const calls = inspector.callGraph().filter(call => call.callee).map(call => ({...call, member: inspector.resolveToken(call.callee)}));
    const objectCalls = calls.filter(call => call.member.owner === 'System.Object' && call.member.name === 'ToString');
    const convertCalls = calls.filter(call => call.member.owner === 'System.Convert' && call.member.name === 'ToString');
    assert.equal(objectCalls.length, 1);
    assert.equal(objectCalls[0].kind, 'callvirt');
    assert.equal(objectCalls[0].member.signature.isStatic, false);
    assert.equal(objectCalls[0].member.signature.parameters.length, 0);
    assert.equal(convertCalls.length, 2);
    assert(convertCalls.every(call => call.kind === 'call' && call.member.signature.isStatic));
    const machines = [new VirtualMachine(loadAssembly(program.assembly)), new CilVirtualMachine(program.assembly)];
    for (const vm of machines) {
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.output, 'value\nSystem.Text.StringBuilder\n\n');
      } finally { vm.stop(); }
    }
  });

  test(`framework Object.ToString ${pipeline}: null faults after the emitted profile round trip`, () => {
    const program = compile('object value = null;Console.WriteLine(value.ToString());', {pipeline});
    const vm = new VirtualMachine(loadAssembly(program.assembly));
    try {
      const result = vm.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, 'NullReferenceException');
    } finally { vm.stop(); }
  });
}

for (const [engine, create] of Object.entries(engines)) {
  test(`framework Object.ToString ${engine}: object references invoke only opted-in framework overrides`, () => {
    const program = compile('var builder = new StringBuilder("value");builder.Append("!");' +
      'object first = builder;object second = new Uri("https://example.com/path?q=1");' +
      'Console.WriteLine(first.ToString());Console.WriteLine(second.ToString());');
    const vm = create(program);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'value!\nhttps://example.com/path?q=1\n');
    } finally { vm.stop(); }
  });

  test(`framework Object.ToString ${engine}: primitive, Convert and Console profiles remain unchanged`, () => {
    const vm = create(compile('object number = 42;Console.WriteLine(number.ToString() == Convert.ToString(number));' +
      'object value = new StringBuilder("text");Console.WriteLine(Convert.ToString(value));Console.WriteLine(value);' +
      'object empty = null;Console.WriteLine(Convert.ToString(empty));'));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'True\nSystem.Text.StringBuilder\nSystem.Text.StringBuilder\n\n');
      assert.equal(vm.value(render(vm, engine, 42)), '42');
    } finally { vm.stop(); }
  });

  test(`framework Object.ToString ${engine}: null receiver faults`, () => {
    const vm = create(compile('object value = null;Console.WriteLine(value.ToString());'));
    try {
      const result = vm.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, 'NullReferenceException');
    } finally { vm.stop(); }
  });

  test(`framework Object.ToString ${engine}: GC, snapshot and allocation faults preserve builder state`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    const {platform, heap} = vm;
    try {
      heap.withRoots([], () => {
        const input = heap.string('retained');
        const builder = platform.invoke(member('System.Text.StringBuilder', '.ctor', ['string']), [input]);
        heap.pins.push(builder);
        const state = heap.snapshot();
        heap.collect();
        heap.restore(state);
        heap.threshold = 0;
        assert.equal(vm.value(render(vm, engine, builder)), 'retained');
        const pins = heap.pins.length;
        const budget = heap.maxBytes;
        heap.maxBytes = 1;
        assert.throws(() => render(vm, engine, builder), {name: 'OutOfMemoryException'});
        assert.equal(heap.pins.length, pins);
        heap.maxBytes = budget;
        assert.equal(vm.value(render(vm, engine, builder)), 'retained');
      });
    } finally { vm.stop(); }
  });

  test(`framework Object.ToString ${engine}: unmarked framework methods stay on the fallback profile`, () => {
    const vm = create(compile('Console.WriteLine(0);'));
    try {
      vm.heap.withRoots([], () => {
        const value = vm.platform.invoke(member('System.Net.Http.HttpMethod', '.ctor', ['string']), [vm.heap.string('GET')]);
        vm.heap.pins.push(value);
        assert.equal(vm.value(vm.platform.invoke(member('System.Net.Http.HttpMethod', 'ToString'), [value])), 'GET');
        assert.equal(vm.value(render(vm, engine, value)), 'System.Net.Http.HttpMethod');
      });
    } finally { vm.stop(); }
  });
}

for (const input of objectStringInputs) {
  for (const kind of ['call', 'callvirt']) {
    test(`framework Object.ToString CIL: ${kind} ${input[0]} matches native`, () => {
      const expected = reference.rows.find(row => row.name === input[0] && row.kind === kind);
      const vm = new CilVirtualMachine(objectStringAssembly(input, kind));
      try {
        const result = vm.run();
        assert.equal(result.state, expected.fault ? 'faulted' : 'terminated', result.fault?.stack);
        if (expected.fault) assert.equal(result.fault.name, expected.fault);
        else assert.equal(vm.value(vm.returnValue), expected.value);
      } finally { vm.stop(); }
    });
  }
}

test('framework Object.ToString CIL: hidden user method is not an override', () => {
  const vm = new CilVirtualMachine(hiddenStringAssembly());
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(vm.value(vm.returnValue), 'Fixture.Program');
    assert.equal(reference.rows.find(row => row.name === 'hidden' && row.kind === 'callvirt').value, 'HiddenString');
  } finally { vm.stop(); }
});

for (const kind of ['call', 'callvirt']) {
  test(`framework Object.ToString CIL: ${kind} retains released primitive formatting`, () => {
    const vm = new CilVirtualMachine(primitiveStringAssembly(kind));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(vm.value(vm.returnValue), '42');
      // Native nonvirtual Int32 returns System.Int32; changing that old profile is outside this batch.
      assert.equal(reference.rows.find(row => row.name === 'int' && row.kind === kind).value,
        kind === 'call' ? 'System.Int32' : '42');
    } finally { vm.stop(); }
  });
}

test('framework Object.ToString metadata rejects invalid override opt-ins', () => {
  const invalid = [{isStatic: true}, {result: 'int'}, {parameters: ['string']}, {name: 'Other'},
    {objectToStringOverride: false}, {isAbstract: true}, {kind: 'constructor'}];
  for (const options of invalid) {
    const registry = createRegistry({reservations: [{name: 'example', start: 0, size: 4}]});
    assert.throws(() => registry.register({name: 'example', register(api) {
      api.define('Example');
      api.member('Example', options.name ?? 'ToString', options.parameters ?? [], options.result ?? 'string',
        {objectToStringOverride: options.objectToStringOverride ?? true, isStatic: options.isStatic ?? false,
          isAbstract: options.isAbstract ?? false, kind: options.kind ?? 'method'});
    }}), /Object.ToString override/);
  }
});
