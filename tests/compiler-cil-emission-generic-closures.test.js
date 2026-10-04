import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: closures and state machines in generic code. The fixture `generic-closures`
// (packages/compiler/test/cil-emission) runs them end to end against the Roslyn build on real .NET (SDK 10.0.201);
// these tests pin which synthesized classes and methods are generic, and how the code names them.

const GENERIC_PARAM = 42;
const TYPE_DEF = 2;
const METHOD_DEF = 6;

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    type = name => inspector.types.find(candidate => candidate.name === name) ?? assert.fail(`no type ${name}`),
    methodOf = (owner, name) => type(owner).methods.find(candidate => candidate.name === name) ?? assert.fail(`no method ${owner}::${name}`),
    // GenericParam rows are `[Number, Flags, Owner, Name]`; Owner is a TypeOrMethodDef coded index (low bit: MethodDef).
    genericParameters = (table, token) =>
      inspector.metadata.rows[GENERIC_PARAM].filter(row => (row[2] & 1 ? METHOD_DEF : TYPE_DEF) === table && row[2] >> 1 === (token & 0xffffff)).length;
  return {
    inspector,
    type,
    typeNames: inspector.types.map(candidate => candidate.name),
    typeArity: name => genericParameters(TYPE_DEF, type(name).token),
    methodArity: (owner, name) => genericParameters(METHOD_DEF, methodOf(owner, name).token),
    lines(owner, name) {
      return inspector.getMethod(methodOf(owner, name).token).instructions.map(instruction => {
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
const refused = source => {
  const result = compileToAssembly(source, { name: 'Sample' });
  assert.equal(result.assembly, null);
  return result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
};

test('A02-T30 a closure in a generic class is nested in it and named through the instantiation of the class', () => {
  const { lines, typeArity, type } = emit(`using System;
    class Box<U> { U held; public Func<U> Held() { return () => held; } public Func<U> Fixed(U value) { return () => value; } }
    class C { static void Main() { } }`);
  // A lambda that only uses `this` is a method of the class; a member of a generic class is a MemberRef on its TypeSpec.
  assert.deepEqual(lines('Box`1', 'Held').slice(0, 2), ['ldarg.0', 'ldftn Box`1<!0>::<Held>b__0']);
  const closure = type('Box`1+<>c__DisplayClass1');
  assert.equal(typeArity('Box`1+<>c__DisplayClass1'), 1, 'a nested class has the type parameters of its enclosing class');
  assert.deepEqual(
    closure.fields.map(field => field.name),
    ['value'],
  );
  const body = lines('Box`1', 'Fixed');
  assert.ok(body.includes('newobj Box`1+<>Cell_0<!0>::.ctor'));
  assert.ok(body.includes('stfld Box`1+<>Cell_0<!0>::Value'));
  assert.ok(body.includes('newobj Box`1+<>c__DisplayClass1<!0>::.ctor'));
  assert.ok(body.includes('ldftn Box`1+<>c__DisplayClass1<!0>::<Fixed>b__1'));
  assert.deepEqual(lines('Box`1+<>c__DisplayClass1', '<Fixed>b__1').slice(0, 3), [
    'ldarg.0',
    'ldfld Box`1+<>c__DisplayClass1<!0>::value',
    'ldfld Box`1+<>Cell_0<!0>::Value',
  ]);
});

test('A02-T30 a closure in a generic method declares copies of the method type parameters', () => {
  const { lines, typeArity } = emit(`using System;
    class Box<U> { U held; public Func<K, U> Keyed<K>(K key) { return k => k.Equals(key) ? held : default(U); } }
    class C { static void Main() { } }`),
    closure = 'Box`1+<>c__DisplayClass0`1',
    cell = 'Box`1+<>Cell_0`1';
  assert.equal(typeArity(closure), 2, 'U of the enclosing class and a copy of K');
  assert.equal(typeArity(cell), 2);
  // In the method the classes are named over the method's own parameter; in the closure class over the copy.
  const body = lines('Box`1', 'Keyed');
  assert.ok(body.includes(`newobj ${cell}<!0, !!0>::.ctor`));
  assert.ok(body.includes(`newobj ${closure}<!0, !!0>::.ctor`));
  assert.ok(body.includes(`ldftn ${closure}<!0, !!0>::<Keyed>b__0`));
  assert.ok(body.includes('newobj System.Func`2<!!0, !0>::.ctor'));
  const lambda = lines(closure, '<Keyed>b__0');
  assert.ok(lambda.includes(`ldfld ${closure}<!0, !1>::key`));
  assert.ok(lambda.includes(`ldfld ${cell}<!0, !1>::Value`));
  assert.ok(lambda.includes('box !1'), 'K in the lambda body is the class parameter');
});

test('A02-T30 a lambda without captures in a generic method is a generic method of the containing type', () => {
  const { methodArity, typeNames } = emit(`using System;
    class C { static Func<K, K> Same<K>() { return k => k; } static void Main() { } }`);
  assert.deepEqual(typeNames, ['<Module>', 'C'], 'no closure class');
  assert.equal(methodArity('C', '<Same>b__0'), 1);
  assert.equal(methodArity('C', 'Same'), 1);
});

test('A02-T30 a generic local function is a generic method; one that captures is a generic method of its closure class', () => {
  const { methodArity, typeArity, lines, inspector } = emit(`using System;
    class C {
      static int Count<T>(T[] items) {
        int total = 0;
        void Add<V>(V item) { total++; }
        V Echo<V>(V item) { return item; }
        foreach (T item in items) Add(Echo(item));
        return total;
      }
      static void Main() { }
    }`),
    closure = 'C+<>c__DisplayClass0`1';
  assert.equal(typeArity(closure), 1, 'the closure class has a copy of T');
  assert.equal(methodArity(closure, '<Count>g__Add|0'), 1, 'and its method declares V only');
  assert.equal(methodArity('C', '<Count>g__Echo|1'), 2, 'a static function declares T and V');
  const method = inspector.types.find(candidate => candidate.name === 'C').methods.find(candidate => candidate.name === 'Count'),
    calls = inspector
      .getMethod(method.token)
      .instructions.filter(instruction => instruction.name === 'call')
      .map(instruction => instruction.operand >>> 24);
  assert.deepEqual(calls, [0x2b, 0x2b], 'both calls are MethodSpecs: the functions are instantiated at the call');
  assert.ok(lines('C', 'Count').includes(`call ${closure}<!!0>::<Count>g__Add|0`));
});

test('A02-T30 an iterator and an async method of generic code have generic state machines', () => {
  const { typeArity, lines, type, inspector } = emit(`using System.Collections.Generic; using System.Threading.Tasks;
    class Ring<T> { T[] items; public IEnumerable<T> All() { foreach (T item in items) yield return item; } }
    static class S {
      public static IEnumerable<T> Twice<T>(T value) { yield return value; yield return value; }
      public static async Task<T> Later<T>(T value) { await Task.Delay(1); return value; }
    }
    class C { static void Main() { } }`);
  assert.equal(typeArity('Ring`1+<All>d__0'), 1);
  assert.equal(typeArity('S+<Twice>d__0`1'), 1);
  assert.equal(typeArity('S+<Later>d__1`1'), 1);
  assert.ok(
    type('S+<Twice>d__0`1')
      .interfaces.map(token => inspector.metadata.typeName(token))
      .includes('System.Collections.Generic.IEnumerable`1<!0>'),
    'the interfaces are written over the class parameter',
  );
  assert.deepEqual(lines('S', 'Twice').slice(1, 5), [
    'newobj S+<Twice>d__0`1<!!0>::.ctor',
    'dup',
    'ldarg.0',
    'stfld S+<Twice>d__0`1<!!0>::<>3__value',
  ]);
  const kickoff = lines('S', 'Later'),
    builder = 'System.Runtime.CompilerServices.AsyncTaskMethodBuilder`1';
  assert.ok(kickoff.includes(`call ${builder}<!!0>::Create`));
  assert.ok(kickoff.includes('stfld S+<Later>d__1`1<!!0>::<>t__builder'));
  const moveNext = lines('S+<Later>d__1`1', 'MoveNext');
  assert.ok(moveNext.includes('ldfld S+<Later>d__1`1<!0>::<>1__state'), 'the machine names its own fields through its instantiation');
  assert.ok(moveNext.includes(`call ${builder}<!0>::SetResult`));
  assert.ok(lines('Ring`1+<All>d__0', 'MoveNext').includes('ldfld Ring`1<!0>::items'));
});

test('A02-T30 a function inside a generic local function emits', () => {
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
