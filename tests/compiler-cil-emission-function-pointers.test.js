import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compile, compileToAssembly } from '@sharpforge/compiler';

// The sibling function-pointers.cs fixture is compiled by Roslyn and SharpForge and compared on the same .NET
// runtime by packages/compiler/test/cil-emission/verify-dotnet.mjs. These tests inspect exact IL and rejection paths.

const program = body => `unsafe class Program { ${body} }`;
const errorsOf = result => result.diagnostics.filter(entry => entry.severity === 'error');
const codes = source => errorsOf(compileToAssembly(source, { allowUnsafe: true })).map(entry => entry.code);

function emit(source) {
  const result = compileToAssembly(source, { allowUnsafe: true, name: 'FunctionPointers' });
  assert.deepEqual(errorsOf(result).map(entry => `${entry.code}: ${entry.message}`), []);
  assert.ok(result.assembly);
  const inspector = new AssemblyInspector(result.assembly);
  const owner = inspector.types.find(type => type.name === 'Program');
  return {
    inspector,
    instructions(name) {
      const method = owner.methods.find(candidate => candidate.name === name);
      assert.ok(method, `missing Program::${name}`);
      return inspector.getMethod(method.token).instructions;
    },
    signature(instruction) {
      assert.equal(instruction.name, 'calli');
      assert.equal(instruction.operand >>> 24, 0x11);
      return [...inspector.metadata.blob(inspector.metadata.row(instruction.operand)[0])];
    },
  };
}

test('SF-A02-T73 generic method addresses use MethodSpec; managed calls use StandAloneSig', () => {
  const emitted = emit(program(`
    static T Identity<T>(T value) => value;
    static int Main() { delegate*<int, int> pointer = &Identity<int>; return pointer(23); }
  `));
  const body = emitted.instructions('Main');
  assert.equal(body.find(instruction => instruction.name === 'ldftn').operand >>> 24, 0x2b);
  assert.deepEqual(emitted.signature(body.find(instruction => instruction.name === 'calli')), [0, 1, 8, 8]);
});

test('SF-A02-T73 method-address arguments and inferred generic method groups bind', () => {
  const emitted = emit(program(`
    static T Identity<T>(T value) => value;
    static int Invoke(delegate*<int, int> pointer, int value) => pointer(value);
    static int Main() { delegate*<int, int> pointer = &Identity; return Invoke(&Identity, pointer(7)); }
  `));
  assert.equal(emitted.instructions('Main').filter(instruction => instruction.name === 'ldftn').length, 2);
  assert.ok(emitted.instructions('Invoke').some(instruction => instruction.name === 'calli'));
});

test('SF-A02-T73 function-pointer arrays load and store native-width elements', () => {
  const emitted = emit(program(`
    static int Add(int first, int second) => first + second;
    static int Main() { delegate*<int, int, int>[] pointers = { &Add }; return pointers[0](3, 4); }
  `));
  const body = emitted.instructions('Main');
  assert.ok(body.some(instruction => instruction.name === 'stelem.i'));
  assert.ok(body.some(instruction => instruction.name === 'ldelem.i'));
  assert.equal(body.find(instruction => instruction.name === 'newarr').operand >>> 24, 0x1b);
});

test('SF-A02-T73 by-reference parameter slots preserve required In and Out modifiers', () => {
  const emitted = emit(program(`
    static void Update(ref int value, out int copied, in int offset) { value += offset; copied = value; }
    static int Main() {
      delegate*<ref int, out int, in int, void> pointer = &Update;
      int value = 1, offset = 2; pointer(ref value, out int copied, in offset); return copied;
    }
  `));
  const signature = emitted.signature(emitted.instructions('Main').find(instruction => instruction.name === 'calli'));
  assert.deepEqual(signature.slice(0, 5), [0, 3, 1, 0x10, 8]);
  assert.equal(signature.filter(byte => byte === 0x10).length, 3);
  assert.equal(signature.filter(byte => byte === 0x1f).length, 2);
});

test('SF-A02-T73 reference-returning indirect calls yield assignable storage', () => {
  const emitted = emit(program(`
    static int storage;
    static ref int Cell() => ref storage;
    static int Main() { delegate*<ref int> pointer = &Cell; pointer() = 31; return pointer(); }
  `));
  const body = emitted.instructions('Main');
  assert.ok(body.some(instruction => instruction.name === 'stind.i4'));
  assert.ok(body.some(instruction => instruction.name === 'ldind.i4'));
  for (const call of body.filter(instruction => instruction.name === 'calli')) assert.deepEqual(emitted.signature(call), [0, 0, 0x10, 8]);
});

test('SF-A02-T73 reference variance leaves function pointers unchanged', () => {
  const emitted = emit(program(`
    static string Text(object value) => "text";
    static void Main() { delegate*<object, string> first = &Text; delegate*<string, object> second = first; second("value"); }
  `));
  assert.ok(!emitted.instructions('Main').some(instruction => ['castclass', 'box', 'newobj'].includes(instruction.name)));
  assert.deepEqual(codes(program(`
    static void Main() { delegate*<int, int> first = null; delegate*<long, long> second = first; }
  `)), ['CS0266']);
});

test('SF-A02-T73 UnmanagedCallersOnly CallConvs selects the calli convention', () => {
  const emitted = emit(`using System.Runtime.CompilerServices; using System.Runtime.InteropServices; ${program(`
    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) })] static int Native(int value) => value;
    static int Main() { delegate* unmanaged[Cdecl]<int, int> pointer = &Native; return pointer(0); }
  `)}`);
  assert.deepEqual(emitted.signature(emitted.instructions('Main').find(instruction => instruction.name === 'calli')), [1, 1, 8, 8]);
});

test('SF-A02-T73 extensible unmanaged conventions are encoded as return modifiers', () => {
  const emitted = emit(program(`
    static int Invoke(delegate* unmanaged[Cdecl, SuppressGCTransition]<int, int> pointer) => pointer(1);
    static void Main() { }
  `));
  const signature = emitted.signature(emitted.instructions('Invoke').find(instruction => instruction.name === 'calli'));
  assert.deepEqual(signature.slice(0, 2), [9, 1]);
  assert.equal(signature.filter(byte => byte === 0x20).length, 2);
  assert.deepEqual(signature.slice(-2), [8, 8]);
});

test('SF-A02-T73 null and default function pointers use native zero', () => {
  const emitted = emit(program(`static void Main() { delegate*<int> pointer = null; pointer = default; }`));
  const names = emitted.instructions('Main').map(instruction => instruction.name);
  assert.ok(!names.includes('ldnull'));
  assert.equal(names.filter(name => name === 'conv.u').length, 2);
});

test('SF-A02-T73 indirect arguments enforce ref kinds and variable storage', () => {
  assert.deepEqual(codes(program(`static void Main() { delegate*<ref int, void> pointer = null; pointer(1); }`)), ['CS1620']);
  assert.deepEqual(codes(program(`static void Main() { delegate*<int, void> pointer = null; int value = 1; pointer(ref value); }`)), ['CS1615']);
  assert.deepEqual(codes(program(`static void Main() { delegate*<ref int, void> pointer = null; pointer(ref 1); }`)), ['CS1510']);
});

test('SF-A02-T73 incompatible conventions, invalid marker types and named arguments are diagnostics', () => {
  assert.deepEqual(codes(`using System.Runtime.CompilerServices; using System.Runtime.InteropServices; ${program(`
    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) })] static int Native(int value) => value;
    static void Main() { delegate* unmanaged[Stdcall]<int, int> pointer = &Native; }
  `)}`), ['CS8786']);
  assert.deepEqual(codes(`using System.Runtime.InteropServices; ${program(`
    [UnmanagedCallersOnly(CallConvs = new[] { typeof(string) })] static void Native() { }
    static void Main() { }
  `)}`), ['CS8893']);
  assert.deepEqual(codes(program(`static void Main() { delegate*<int, void> pointer = null; pointer(value: 1); }`)), ['CS8905']);
});

test('SF-A02-T73 the image backend explicitly rejects indirect invocation', () => {
  const result = compile(program(`static void Run(delegate*<int> pointer) { pointer(); } static void Main() { }`), { allowUnsafe: true });
  assert.equal(result.image, null);
  assert.ok(errorsOf(result).some(entry => entry.code === 'SF2200'));
  assert.ok(!errorsOf(result).some(entry => entry.code === 'SF2201'));
});
