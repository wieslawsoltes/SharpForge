import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, decodeCoded, MethodAttributes } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: four kinds of assemblies real .NET used to reject at load or JIT - file-local types, static abstract
// interface members, an interface indexer implemented under another name, extension blocks. Reference: the fixture
// `interface-members-and-file-types` of packages/compiler/test/cil-emission prints on .NET 10 what the Roslyn build
// prints (verify-dotnet.mjs).

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    metadata = inspector.metadata,
    type = name => inspector.types.find(candidate => candidate.name === name) ?? assert.fail(`no type ${name}`),
    method = (owner, name) => type(owner).methods.find(candidate => candidate.name === name) ?? assert.fail(`no method ${owner}::${name}`);
  return {
    inspector,
    metadata,
    type,
    method,
    lines(owner, name) {
      return inspector.getMethod(method(owner, name).token).instructions.map(instruction => {
        if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
        const token = instruction.operand,
          table = token >>> 24;
        if (table === 1 || table === 2 || table === 27) return `${instruction.name} ${metadata.typeName(token)}`;
        const target = inspector.resolveToken(token);
        return `${instruction.name} ${target.owner}::${target.name}`;
      });
    },
    /** MethodImpl rows as `[body token, name of the declaration]`. */
    implementations() {
      return (metadata.rows[25] ?? []).map(row => {
        const declaration = decodeCoded('MethodDefOrRef', row[2]);
        return [decodeCoded('MethodDefOrRef', row[1]), inspector.resolveToken(declaration).owner + '::' + inspector.resolveToken(declaration).name];
      });
    },
  };
}

test('A02-T30 a file-local type is a TypeDef of the assembly with a name of its file', () => {
  const { inspector, lines } = emit(`file class Helper { public int Twice(int v) => v * 2; }
    class C { static int Main() { return new Helper().Twice(2); } }`);
  const helper = inspector.types.find(candidate => candidate.name.endsWith('__Helper'));
  assert.ok(helper, 'the type is defined, not referenced');
  assert.match(helper.name, /^<[A-Za-z0-9_]*>F[0-9A-F]{8}__Helper$/);
  assert.ok(lines('C', 'Main').includes(`newobj ${helper.name}::.ctor`));
});

test('A02-T30 static abstract interface members: flags, constrained calls and MethodImpl rows', () => {
  const { method, lines, implementations } = emit(`interface IAdd<T> where T : IAdd<T> {
      static abstract T operator +(T a, T b);
      static abstract T Zero { get; }
      static virtual string Describe() { return "n"; }
    }
    class Num : IAdd<Num> {
      public static Num operator +(Num a, Num b) { return a; }
      public static Num Zero { get { return new Num(); } }
      public static string Describe() { return "num"; }
    }
    class C {
      static T Sum<T>(T a) where T : IAdd<T> { return T.Zero + a; }
      static string Name<T>() where T : IAdd<T> { return T.Describe(); }
      static int Main() { return Sum(new Num()) == null ? 1 : Name<Num>().Length; }
    }`);
  const slot = MethodAttributes.Static | MethodAttributes.Virtual | MethodAttributes.Abstract;
  assert.equal(method('IAdd`1', 'op_Addition').flags & slot, slot);
  assert.equal(method('IAdd`1', 'get_Zero').flags & slot, slot, 'an accessor takes the modifiers of its property');
  assert.equal(method('IAdd`1', 'Describe').flags & slot, MethodAttributes.Static | MethodAttributes.Virtual);
  assert.equal(method('IAdd`1', 'get_Zero').rva, 0, 'an abstract member has no body');
  assert.deepEqual(lines('C', 'Sum'), [
    'constrained. !!0',
    'call IAdd`1<!!0>::get_Zero',
    'ldarg.0',
    'constrained. !!0',
    'call IAdd`1<!!0>::op_Addition',
    'ret',
  ]);
  assert.deepEqual(lines('C', 'Name'), ['constrained. !!0', 'call IAdd`1<!!0>::Describe', 'ret']);
  // Each implementation is stated once, the static virtual member with a body included.
  const rows = implementations().map(row => row[1]).sort();
  assert.deepEqual(rows, ['IAdd`1<Num>::Describe', 'IAdd`1<Num>::get_Zero', 'IAdd`1<Num>::op_Addition']);
});

test('A02-T30 an interface member implemented under another name gets a MethodImpl row; a same-named one does not', () => {
  const { method, implementations } = emit(`using System.Runtime.CompilerServices;
    interface IRow { [IndexerName("Row")] string this[int i] { get; } int Count { get; } }
    class Table : IRow {
      [IndexerName("Entry")] public string this[int i] { get { return "r"; } }
      public int Count { get { return 1; } }
    }
    class C { static int Main() { IRow row = new Table(); return row[0].Length + row.Count; } }`);
  assert.deepEqual(implementations(), [[method('Table', 'get_Entry').token, 'IRow::get_Row']]);
  const final = MethodAttributes.Virtual | MethodAttributes.Final | MethodAttributes.NewSlot;
  assert.equal(method('Table', 'get_Entry').flags & final, final);
});

test('A02-T30 the accessor of an extension block property takes the receiver as its first argument', () => {
  const { lines } = emit(`static class E {
      extension(int number) { public bool IsEven => number % 2 == 0; public int Squared => number * number; }
      extension(string text) { public int Twice => text.Length * 2; }
    }
    class C { static int Main() { int n = 4; return 3.IsEven ? 0 : n.Squared + "ab".Twice; } }`);
  const main = lines('C', 'Main');
  assert.equal(main[main.indexOf('call E::get_IsEven') - 1], 'ldc.i4.3', 'the value, not its address');
  assert.equal(main[main.indexOf('call E::get_Squared') - 1], 'ldloc.0');
  assert.equal(main[main.indexOf('call E::get_Twice') - 1], 'ldstr');
});
