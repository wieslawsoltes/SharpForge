import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30, stress round 2: defects found by the round-2 stress programs, checked here without a .NET SDK. The
// behaviour on real .NET is pinned from Roslyn 5.3.0 in the reduced programs named in each test
// (packages/compiler/test/differential/fixtures/reduced/, run by tests/compiler-stress-corpus.test.js).

const errorsOf = diagnostics => diagnostics.filter(entry => entry.severity === 'error').map(entry => entry.code);

/** The instructions of `type::method` as text: `opcode` or `opcode Owner::Member`. */
function instructionsOf(source, typeName, methodName) {
  const result = compileToAssembly(source, { name: 'Sample' });
  assert.deepEqual(errorsOf(result.diagnostics), []);
  const inspector = new AssemblyInspector(result.assembly),
    type = inspector.types.find(candidate => candidate.name === typeName),
    method = type.methods.find(candidate => candidate.name === methodName);
  return inspector.getMethod(method.token).instructions.map(instruction => {
    if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
    const target = inspector.resolveToken(instruction.operand);
    return `${instruction.name} ${target.owner ?? ''}::${target.name}`;
  });
}

test('A02-T30 a state machine guards its finally blocks with the state cached in a local (reduced-async/suspension-does-not-run-finally)', () => {
  const source = `using System; using System.Threading.Tasks;
    class P {
      static async Task<int> Work() {
        int total = 0;
        try { await Task.Yield(); total++; } finally { total += 10; }
        return total;
      }
      static void Main() { Console.WriteLine(Work().Result); }
    }`;
  const result = compileToAssembly(source, { name: 'Sample' });
  assert.deepEqual(errorsOf(result.diagnostics), []);
  const inspector = new AssemblyInspector(result.assembly),
    machine = inspector.types.find(candidate => /Work/.test(candidate.name) && candidate.methods.some(method => method.name === 'MoveNext')),
    moveNext = machine.methods.find(method => method.name === 'MoveNext'),
    body = inspector.getMethod(moveNext.token),
    names = body.instructions.map(instruction => instruction.name),
    isStateField = instruction => instruction.operandKind === 'token' && /state/.test(inspector.resolveToken(instruction.operand).name ?? '');
  // The state is read from the field once, at the start; every store of a state also stores the local.
  const loads = body.instructions.filter(instruction => instruction.name === 'ldfld' && isStateField(instruction)),
    stores = body.instructions
      .map((instruction, index) => ({ instruction, index }))
      .filter(entry => entry.instruction.name === 'stfld' && isStateField(entry.instruction));
  assert.ok(stores.length >= 2, names.join(' '));
  for (const { index } of stores) assert.deepEqual(names.slice(index - 2, index).map(name => name.split('.')[0]), ['dup', 'stloc'], names.join(' '));
  // The guard of the finally block compares the local with -1 (running); it does not read the field again.
  const guard = names.findIndex((name, index) => /^ldloc/.test(name) && names[index + 1] === 'ldc.i4.m1' && /^bne\.un/.test(names[index + 2]));
  assert.ok(guard > 0, names.join(' '));
  assert.equal(body.instructions.filter((instruction, index) => loads.includes(instruction) && names[index + 1] === 'ldc.i4.m1').length, 0);
  assert.deepEqual([names[0], names[1], names[2].split('.')[0]], ['ldarg.0', 'ldfld', 'stloc']);
});

test('A02-T30 `T.Create` as a delegate is a constrained ldftn on the type parameter (reduced-interfaces/static-virtual-member-as-delegate)', () => {
  const body = instructionsOf(
    `using System;
     interface IFactory<TSelf> where TSelf : IFactory<TSelf> { static abstract TSelf Create(string text); }
     class Meter : IFactory<Meter> { public static Meter Create(string text) => new Meter(); }
     class P {
       static Func<string, T> Maker<T>() where T : IFactory<T> => T.Create;
       static void Main() { Console.WriteLine(Maker<Meter>()("1") != null); }
     }`,
    'P',
    'Maker',
  );
  const at = body.findIndex(name => name.startsWith('ldftn'));
  assert.ok(at > 0, body.join('; '));
  assert.match(body[at - 1], /^constrained\./, body.join('; '));
});

test('A02-T30 `default` as an operand of a user-defined operator has the parameter type (reduced-conversions/typeless-operands-of-user-operators)', () => {
  const declarations = `struct V { public int N;
      public static bool operator ==(V left, V right) => left.N == right.N;
      public static bool operator !=(V left, V right) => left.N != right.N;
      public override bool Equals(object other) => false; public override int GetHashCode() => 0; }`;
  const program = 'class P { static bool Same(V value) => value == default; static void Main() { Console.WriteLine(Same(new V())); } }',
    body = instructionsOf(`using System; ${declarations} ${program}`, 'P', 'Same');
  assert.ok(!body.includes('ldnull'), body.join('; '));
  assert.ok(body.some(name => name.startsWith('initobj')), body.join('; '));
});

test('A02-T30 a conditional without a natural type inside a tuple literal takes the element type (reduced-tuples/target-typed-elements)', () => {
  const body = instructionsOf(
    `using System;
     class P {
       static (int[] Items, int? Next) Page(int page) => (new int[page], page < 2 ? page + 1 : null);
       static void Main() { Console.WriteLine(Page(1).Next.HasValue); }
     }`,
    'P',
    'Page',
  );
  // Both branches produce an `int?`: a constructed value and a default value, then the tuple.
  assert.ok(body.some(name => /^newobj .*Nullable.*::\.ctor/.test(name)), body.join('; '));
  assert.ok(body.some(name => name.startsWith('initobj')), body.join('; '));
  assert.ok(body.some(name => /^newobj .*ValueTuple.*::\.ctor/.test(name)), body.join('; '));
});
