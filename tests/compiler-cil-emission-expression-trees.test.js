import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: lambdas converted to `Expression<TDelegate>` emitted as the factory calls of
// System.Linq.Expressions.Expression. The fixture `expression-trees` (packages/compiler/test/cil-emission) builds,
// prints, walks and compiles trees against the Roslyn build on real .NET (SDK 10.0.201); these tests pin the calls.

const CUSTOM_ATTRIBUTE = 12;
const E = 'System.Linq.Expressions.Expression';

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    type = name => inspector.types.find(candidate => candidate.name === name) ?? assert.fail(`no type ${name}`),
    methodOf = (owner, name) => type(owner).methods.find(candidate => candidate.name === name) ?? assert.fail(`no method ${owner}::${name}`);
  return {
    inspector,
    type,
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
test('A02-T30 a lambda converted to an expression tree is built by factory calls, not compiled to a method', () => {
  const { lines, type } = emit(`using System; using System.Linq.Expressions;
    class C { static Expression<Func<int, int>> Make() { return x => x + 1; } static void Main() { } }`);
  assert.deepEqual(
    type('C').methods.map(method => method.name),
    ['Make', 'Main', '.ctor'],
    'no method for the lambda',
  );
  assert.deepEqual(lines('C', 'Make'), [
    'ldtoken System.Int32',
    'call System.Type::GetTypeFromHandle',
    'ldstr',
    `call ${E}::Parameter`,
    'stloc.0',
    'ldloc.0',
    'ldc.i4.1',
    'box System.Int32',
    'ldtoken System.Int32',
    'call System.Type::GetTypeFromHandle',
    `call ${E}::Constant`,
    `call ${E}::Add`,
    'ldc.i4.1',
    'newarr System.Linq.Expressions.ParameterExpression',
    'dup',
    'ldc.i4.0',
    'ldloc.0',
    'stelem.ref',
    `call ${E}::Lambda`,
    'ret',
  ]);
});

test('A02-T30 members and methods enter a tree through their handles', () => {
  const { lines } = emit(`using System; using System.Linq.Expressions;
    class P { public int X; public int Y { get; set; } public int Sum(int extra) { return X + Y + extra; } }
    class C { static Expression<Func<P, int>> Make() { return p => p.X + p.Y + p.Sum(3); } static void Main() { } }`),
    text = lines('C', 'Make'),
    field = text.indexOf('ldtoken P::X'),
    getter = text.indexOf('ldtoken P::get_Y'),
    method = text.indexOf('ldtoken P::Sum');
  assert.deepEqual(text.slice(field, field + 3), ['ldtoken P::X', 'call System.Reflection.FieldInfo::GetFieldFromHandle', `call ${E}::Field`]);
  assert.deepEqual(text.slice(getter, getter + 4), [
    'ldtoken P::get_Y',
    'call System.Reflection.MethodBase::GetMethodFromHandle',
    'castclass System.Reflection.MethodInfo',
    `call ${E}::Property`,
  ]);
  assert.deepEqual(text.slice(method, method + 3), [
    'ldtoken P::Sum',
    'call System.Reflection.MethodBase::GetMethodFromHandle',
    'castclass System.Reflection.MethodInfo',
  ]);
  assert.ok(text.includes(`call ${E}::Call`));
});

test('A02-T30 a variable of the enclosing method is the field of its cell, held by the tree as a constant', () => {
  const { lines } = emit(`using System; using System.Linq.Expressions;
    class C { static Expression<Func<int, int>> Make(int offset) { return x => x + offset; } static void Main() { } }`),
    text = lines('C', 'Make'),
    constant = text.indexOf(`call ${E}::Constant`);
  assert.equal(text[constant - 1], 'ldloc.0', 'the cell object itself is the constant');
  assert.deepEqual(text.slice(constant + 1, constant + 4), [
    'ldtoken C+<>Cell_0::Value',
    'call System.Reflection.FieldInfo::GetFieldFromHandle',
    `call ${E}::Field`,
  ]);
});

test('A02-T30 string concatenation and user-defined operators name their methods', () => {
  const { lines } = emit(`using System; using System.Linq.Expressions;
    class M { public static M operator +(M a, M b) { return a; } public static bool operator ==(M a, M b) { return true; }
      public static bool operator !=(M a, M b) { return false; } public override bool Equals(object o) { return false; }
      public override int GetHashCode() { return 0; } }
    class C {
      static Expression<Func<string, string>> Text() { return s => s + "!"; }
      static Expression<Func<M, M, bool>> Same() { return (a, b) => a + b == b; }
      static void Main() { }
    }`),
    text = lines('C', 'Text'),
    same = lines('C', 'Same');
  assert.ok(text.includes('ldtoken System.String::Concat'));
  assert.ok(same.includes('ldtoken M::op_Addition'));
  const equality = same.indexOf('ldtoken M::op_Equality');
  assert.equal(same[equality - 1], 'ldc.i4.0', 'liftToNull is false');
  assert.equal(same[equality + 3], `call ${E}::Equal`);
});

test('A02-T30 an extension method, its class and the assembly carry ExtensionAttribute', () => {
  const { inspector } = emit(`static class X { public static int Plus(this int value, int other) { return value + other; } }
    class C { static void Main() { } }`),
    rows = inspector.metadata.rows[CUSTOM_ATTRIBUTE],
    // CustomAttribute rows are `[Parent, Type, Value]`; Type is a CustomAttributeType coded index (3 bits; 3 = MemberRef).
    owners = rows.map(row => inspector.resolveToken(((0x0a << 24) | (row[1] >> 3)) >>> 0).owner);
  assert.equal(owners.filter(owner => owner === 'System.Runtime.CompilerServices.ExtensionAttribute').length, 3);
});

test('A02-T30 lifted arithmetic emits the nullable operands and the ordinary binary factory', () => {
  const { lines } = emit(`using System; using System.Linq.Expressions;
    class C { static Expression<Func<int?, int?>> Make() { return x => x + 1; } static void Main() { } }`);
  assert.ok(lines('C', 'Make').includes(`call ${E}::Add`));
  assert.ok(lines('C', 'Make').includes(`call ${E}::Convert`));
});
