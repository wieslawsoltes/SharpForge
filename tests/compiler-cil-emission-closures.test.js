import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, TypeAttributes, MethodAttributes } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: lambdas, local functions, delegates and events emitted as CIL from bound trees. The fixtures `closures`
// and `delegates-and-events` (packages/compiler/test/cil-emission) run them end to end and are verified against the
// Roslyn build on real .NET; these tests pin what closure conversion declares and the instructions that use it.

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    type = name => inspector.types.find(candidate => candidate.name === name) ?? assert.fail(`no type ${name}`);
  return {
    inspector,
    type,
    typeNames: inspector.types.map(candidate => candidate.name),
    lines(owner, name) {
      const method = type(owner).methods.find(candidate => candidate.name === name) ?? assert.fail(`no method ${owner}::${name}`);
      return inspector.getMethod(method.token).instructions.map(instruction => {
        if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
        const token = instruction.operand,
          table = token >>> 24;
        if (table === 1 || table === 2 || table === 27) return `${instruction.name} ${inspector.metadata.typeName(token)}`;
        const target = inspector.resolveToken(token);
        return `${instruction.name} ${target.owner}::${target.name}`;
      });
    },
  };
}
const has = (flags, mask) => (flags & mask) === mask;
const refused = source => {
  const result = compileToAssembly(source, { name: 'Sample' });
  assert.equal(result.assembly, null);
  return result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
};

test('A02-T30 a lambda without captures is a static method of the containing type', () => {
  const { type, lines, typeNames } = emit(`using System;
    class C { static void Main() { Func<int, int> twice = x => x * 2; Console.WriteLine(twice(4)); } }`),
    method = type('C').methods.find(candidate => candidate.name.startsWith('<Main>b__'));
  assert.ok(method, 'the lambda method');
  assert.ok(has(method.flags, MethodAttributes.Static));
  assert.deepEqual(typeNames, ['<Module>', 'C'], 'no closure class is declared');
  const main = lines('C', 'Main');
  assert.deepEqual(main.slice(0, 3), ['ldnull', `ldftn C::${method.name}`, 'newobj System.Func`2<int, int>::.ctor']);
  assert.ok(main.includes('callvirt System.Func`2<int, int>::Invoke'));
});

test('A02-T30 a captured local lives in a cell and the lambda in a closure class nested in the containing type', () => {
  const { type, lines, inspector } = emit(`using System;
    class C { static void Main() { int total = 1; Action add = () => { total += 2; }; add(); Console.WriteLine(total); } }`),
    cell = type('C+<>Cell_0'),
    closure = type('C+<>c__DisplayClass0');
  assert.deepEqual(
    cell.fields.map(field => field.name),
    ['Value'],
  );
  assert.deepEqual(
    closure.fields.map(field => field.name),
    ['total'],
  );
  for (const nested of [cell, closure]) assert.equal(nested.flags & TypeAttributes.VisibilityMask, TypeAttributes.NestedPrivate);
  // NestedClass rows name C (TypeDef row 2) as the enclosing class of both.
  assert.deepEqual(
    inspector.metadata.rows[41].map(row => row[1]),
    [2, 2],
  );
  const main = lines('C', 'Main');
  assert.ok(main.includes('newobj C+<>Cell_0::.ctor'), 'the cell is created where the variable is declared');
  assert.ok(main.includes('stfld C+<>c__DisplayClass0::total'), 'the closure object receives the cell');
  assert.ok(main.includes('ldftn C+<>c__DisplayClass0::<Main>b__0'));
  assert.ok(main.includes('ldfld C+<>Cell_0::Value'), 'the method reads the variable through its cell');
  const body = lines('C+<>c__DisplayClass0', '<Main>b__0');
  assert.deepEqual(body.slice(0, 2), ['ldarg.0', 'ldfld C+<>c__DisplayClass0::total']);
});

test('A02-T30 a lambda that only uses this is an instance method of its class', () => {
  const { type, lines } = emit(`using System;
    class C { int seed = 3; Func<int, int> Adder() { return x => x + seed; }
      static void Main() { Console.WriteLine(new C().Adder()(4)); } }`),
    method = type('C').methods.find(candidate => candidate.name.startsWith('<Adder>b__'));
  assert.ok(method && !has(method.flags, MethodAttributes.Static));
  assert.deepEqual(lines('C', 'Adder').slice(0, 2), ['ldarg.0', `ldftn C::${method.name}`]);
});

test('A02-T30 local functions: static when they capture nothing, called on a closure object otherwise', () => {
  const { type, lines } = emit(`using System;
    class C { static void Main() {
      int bonus = 5;
      int Plain(int x) => x + 1;
      int Captures(int x) => x + bonus;
      Console.WriteLine(Plain(1) + Captures(1));
    } }`),
    plain = type('C').methods.find(candidate => candidate.name.startsWith('<Main>g__Plain|'));
  assert.ok(plain && has(plain.flags, MethodAttributes.Static));
  const main = lines('C', 'Main'),
    closureCall = main.find(line => line.startsWith('call C+<>c__DisplayClass') && line.includes('g__Captures|'));
  assert.ok(main.includes(`call C::${plain.name}`));
  assert.ok(closureCall, 'the capturing local function is a method of a closure class');
});

test('A02-T30 method groups: ldftn for a non-virtual method, dup and ldvirtftn for a virtual one', () => {
  const { lines } = emit(`using System;
    class B { public virtual int V(int x) { return x; } public int N(int x) { return x; } public static int S(int x) { return x; } }
    class C {
      static Func<int, int> Static() { return B.S; }
      static Func<int, int> Instance(B b) { return b.N; }
      static Func<int, int> Virtual(B b) { return b.V; }
      static void Main() { }
    }`);
  assert.deepEqual(lines('C', 'Static').slice(0, 2), ['ldnull', 'ldftn B::S']);
  assert.deepEqual(lines('C', 'Instance').slice(0, 2), ['ldarg.0', 'ldftn B::N']);
  assert.deepEqual(lines('C', 'Virtual').slice(0, 3), ['ldarg.0', 'dup', 'ldvirtftn B::V']);
});

test('A02-T30 a field-like event gets add and remove accessors over Delegate.Combine and Remove', () => {
  const { lines } = emit(`using System;
    class Button { public event Action Clicked; public void Click() { Clicked?.Invoke(); } }
    class C { static void Main() { var b = new Button(); b.Clicked += () => Console.WriteLine("x"); b.Click(); } }`);
  assert.deepEqual(lines('Button', 'add_Clicked'), [
    'ldarg.0',
    'ldarg.0',
    'ldfld Button::Clicked',
    'ldarg.1',
    'call System.Delegate::Combine',
    'castclass System.Action',
    'stfld Button::Clicked',
    'ret',
  ]);
  assert.ok(lines('Button', 'remove_Clicked').includes('call System.Delegate::Remove'));
  assert.ok(lines('C', 'Main').includes('callvirt Button::add_Clicked'));
});

test('A02-T30 an anonymous method without a parameter list takes the parameters of its delegate type', () => {
  const { type, inspector } = emit(`using System;
    class C { static void Main() { Action<int, string> a = delegate { Console.WriteLine("called"); }; a(1, "x"); } }`),
    method = type('C').methods.find(candidate => candidate.name.startsWith('<Main>b__'));
  // A method with another parameter list behind the delegate would be invalid, even where a runtime happens to run it.
  assert.deepEqual(inspector.getMethod(method.token).signature.parameters, ['int', 'string']);
});

test('A02-T30 a lambda inside a generic local function is declared, not refused', () => {
  // This asserted SF2200 while such functions could not be declared (tests/compiler-generic-local-function-closures.test.js).
  const source = `using System;
      class C { static void Main() { Func<T> Later<T>(T value) { return () => value; } Console.WriteLine(Later(1)()); } }`;
  const result = compileToAssembly(source, { name: 'Sample' });
  assert.deepEqual(
    result.diagnostics.filter(entry => entry.severity === 'error'),
    [],
  );
  assert.ok(result.assembly);
});
