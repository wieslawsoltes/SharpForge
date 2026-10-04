import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadFixtures, emitFixture, inspectImage, runOnDirectCil, limitKinds } from '../packages/compiler/test/cil-emission/harness.js';

// SF-A02-T30: CIL method bodies emitted from bound trees (`compileToAssembly`), without the bytecode image.
// Reference: every fixture's `.out` is what the Roslyn build of the same program prints on .NET, and
// packages/compiler/test/cil-emission/verify-dotnet.mjs runs the emitted assemblies on that .NET runtime too
// (.NET SDK 10.0.201). Here the image is read back with @sharpforge/cil and run on the direct-CIL runtime.

const fixtures = loadFixtures();

function methodOf(assembly, owner, name) {
  const inspector = new AssemblyInspector(assembly),
    method = [...inspector.methods.values()].find(candidate => candidate.owner === owner && candidate.name === name);
  assert.ok(method, `no method ${owner}::${name}`);
  return { inspector, body: inspector.getMethod(method.token) };
}
const emit = (source, options) => compileToAssembly(source, { name: 'Sample', ...options });
const errorsOf = result => result.diagnostics.filter(entry => entry.severity === 'error');

test('A02-T30 the fixture set is pinned against .NET', () => {
  assert.ok(fixtures.length >= 7, `expected the fixture set, found ${fixtures.length}`);
  for (const fixture of fixtures) {
    assert.equal(typeof fixture.expected, 'string', `${fixture.name}: no pinned .NET output; run verify-dotnet.mjs --update`);
    assert.ok(fixture.expected.length > 0, fixture.name);
  }
});

for (const fixture of fixtures) {
  test(`A02-T30 ${fixture.name}: emits a well-formed image that runs on the direct-CIL runtime`, () => {
    const { assembly, errors } = emitFixture(fixture);
    assert.deepEqual(errors, []);
    assert.ok(assembly instanceof Uint8Array);
    // The validator accepts the image, or reports exactly what the `.image` file pins for an image .NET loads.
    assert.deepEqual(inspectImage(assembly), fixture.imageLimit ? fixture.imageLimit.trimEnd().split('\n') : []);
    const run = runOnDirectCil(assembly),
      observed = run.limit ?? (run.output === fixture.expected ? null : 'output differs\n');
    // Either the runtime prints what .NET prints, or it stops for the kinds of reason the `.vm` file records (the
    // assembly is valid - .NET runs it - and the fixture is not counted as running). The kinds are the verifier's
    // codes: its messages are the runtime's wording and may change without this test noticing. A limit the runtime
    // has since removed needs no change here: the output is then compared like any other.
    if (observed !== null) {
      const recorded = limitKinds(fixture.runtimeLimit ?? '(none recorded)\n');
      assert.deepEqual(limitKinds(observed), recorded, `${fixture.name}: ${observed}${run.output ?? ''}`);
    }
  });
}

test('A02-T30 emission is deterministic and the entry point is a MethodDef', () => {
  const fixture = fixtures.find(candidate => candidate.name === 'calls'),
    first = emitFixture(fixture).assembly,
    second = emitFixture(fixture).assembly;
  assert.deepEqual(first, second);
  const inspector = new AssemblyInspector(first);
  assert.ok(inspector.pe.entryPoint >>> 24 === 6, 'the entry point is a MethodDef');
});

test('A02-T30 checked arithmetic and conversions use the overflow-checking instructions', () => {
  const source = `class C {
    static int Add(int a, int b) { return checked(a + b); }
    static uint Scale(uint a, uint b) { checked { return a * b; } }
    static int Narrow(long value) { return checked((int)value); }
    static byte Wrap(int value) { return (byte)value; }
    static void Main() { }
  }`;
  const { assembly } = emit(source),
    names = name => methodOf(assembly, 'C', name).body.instructions.map(instruction => instruction.name);
  assert.ok(names('Add').includes('add.ovf'));
  assert.ok(names('Scale').includes('mul.ovf.un'));
  assert.ok(names('Narrow').includes('conv.ovf.i4'));
  assert.deepEqual(
    names('Wrap').filter(name => name.startsWith('conv.')),
    ['conv.u1'],
  );
});

test('A02-T30 unsigned operands select the unsigned division, shift and comparison', () => {
  const source = `class C {
    static uint Divide(uint a, uint b) { return a / b; }
    static bool Less(ulong a, ulong b) { return a < b; }
    static uint Shift(uint a, int count) { return a >> count; }
    static long Widen(uint a) { return a; }
    static void Main() { }
  }`;
  const { assembly } = emit(source),
    names = name => methodOf(assembly, 'C', name).body.instructions.map(instruction => instruction.name);
  assert.ok(names('Divide').includes('div.un'));
  assert.ok(names('Less').includes('clt.un'));
  assert.ok(names('Shift').includes('shr.un'));
  assert.ok(names('Widen').includes('conv.u8'), 'an unsigned value is zero-extended');
});

test('A02-T30 a typed catch clause names its exception type and try regions nest innermost first', () => {
  const source = `using System;
  class C {
    static int M(int zero) {
      try { return 10 / zero; }
      catch (DivideByZeroException) { return -1; }
      catch (Exception) { return -2; }
      finally { Console.WriteLine("done"); }
    }
    static void Main() { }
  }`;
  const { assembly } = emit(source),
    { inspector, body } = methodOf(assembly, 'C', 'M'),
    clauses = body.handlers.map(handler => (handler.flags === 0 ? inspector.metadata.typeName(handler.catchType) : 'finally'));
  assert.deepEqual(clauses, ['System.DivideByZeroException', 'System.Exception', 'finally']);
  const [first, second, last] = body.handlers;
  assert.equal(first.start, second.start);
  assert.equal(first.end, second.end);
  assert.ok(last.start <= first.start && last.end >= second.handlerEnd, 'the finally region encloses the catch clauses');
  // `ret` is not allowed inside a protected region: the returns leave to one shared return point.
  const names = body.instructions.map(instruction => instruction.name);
  assert.equal(names.filter(name => name === 'ret').length, 1);
  assert.ok(names.some(name => name.startsWith('leave')));
});

test('A02-T30 a function pointer emits its method address as ldftn', () => {
  const pointer = emit('class C { static int M(int x) { return x; } static unsafe void Main() { delegate*<int, int> f = &M; } }', { allowUnsafe: true });
  assert.equal(pointer.success, true);
  assert.deepEqual(errorsOf(pointer), []);
  const { body } = methodOf(pointer.assembly, 'C', 'Main');
  assert.ok(body.instructions.some(instruction => instruction.name === 'ldftn'));
});

test('A02-T30 a program with errors yields its diagnostics and no assembly', () => {
  const result = emit('class C { static void Main() { int x = "text"; } }');
  assert.equal(result.success, false);
  assert.equal(result.assembly, null);
  assert.deepEqual(
    errorsOf(result).map(entry => entry.code),
    ['CS0029'],
  );
});

test('A02-T30 a library has no entry point; an executable without one is refused', () => {
  const source = 'public class C { public static int Twice(int x) { return x * 2; } }',
    library = emit(source, { outputKind: 'library' });
  assert.deepEqual(errorsOf(library), []);
  assert.equal(new AssemblyInspector(library.assembly).pe.entryPoint, 0);
  const executable = emit(source);
  assert.equal(executable.assembly, null);
  assert.match(errorsOf(executable)[0].message, /entry point/);
});

test('A02-T30 top-level statements become Program.<Main>$ and return the exit code', () => {
  const { assembly, diagnostics } = emit('System.Console.WriteLine(args.Length); return 3;');
  assert.deepEqual(
    diagnostics.filter(entry => entry.severity === 'error'),
    [],
  );
  const { inspector, body } = methodOf(assembly, 'Program', '<Main>$');
  assert.equal(body.signature.returnType, 'int');
  assert.deepEqual(body.signature.parameters, ['string[]']);
  assert.equal(inspector.pe.entryPoint, body.token);
});

test('A02-T30 a recorded runtime limit is compared by its kinds, not by the wording of the runtime', () => {
  const recorded = 'IL_PREFIX: constrained. execution requires a nongeneric user-struct TypeDef\nIL_REFERENCE: External member X is not implemented\n',
    reworded = 'IL_REFERENCE: External member Y is not implemented\nIL_PREFIX: Constrained prefix requires callvirt at 0x0\nIL_PREFIX: again\n';
  assert.deepEqual(limitKinds(recorded), ['IL_PREFIX', 'IL_REFERENCE']);
  assert.deepEqual(limitKinds(reworded), limitKinds(recorded));
  assert.notDeepEqual(limitKinds('fault: Value is incompatible with the array element type\n'), limitKinds(recorded));
  assert.deepEqual(limitKinds('output differs\n'), ['output differs']);
  assert.deepEqual(limitKinds('(none recorded)\n'), ['(none recorded)']);
});
