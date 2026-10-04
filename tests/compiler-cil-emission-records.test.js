import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, decodeCoded, MethodAttributes, FieldAttributes } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: records in CIL emitted from bound trees - the synthesized members, `with`, init accessors and required
// members. References: the fixture `records` of packages/compiler/test/cil-emission prints on .NET 10 what the Roslyn
// build prints (verify-dotnet.mjs), and packages/compiler/test/reference-assembly/records.roslyn.txt is the Roslyn
// build of records.cs read with .NET reflection (compare.mjs: every line agrees except the pending nullable and
// IsReadOnly attributes).

const CMOD_REQUIRED = 0x1f;

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    metadata = inspector.metadata,
    type = name => inspector.types.find(candidate => candidate.name === name) ?? assert.fail(`no type ${name}`),
    method = (owner, name, index = 0) => type(owner).methods.filter(candidate => candidate.name === name)[index] ?? assert.fail(`no method ${owner}::${name}`);
  return {
    inspector,
    metadata,
    type,
    method,
    lines(owner, name, index = 0) {
      return inspector.getMethod(method(owner, name, index).token).instructions.map(instruction => {
        if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
        const token = instruction.operand,
          table = token >>> 24;
        if (table === 1 || table === 2 || table === 27) return `${instruction.name} ${metadata.typeName(token)}`;
        const target = inspector.resolveToken(token);
        return `${instruction.name} ${target.owner}::${target.name}`;
      });
    },
    /** The names of the attributes on a token. */
    attributes(parent) {
      return (metadata.rows[12] ?? [])
        .filter(row => decodeCoded('HasCustomAttribute', row[0]) === parent)
        .map(row => metadata.typeName(decodeCoded('MemberRefParent', metadata.row(decodeCoded('CustomAttributeType', row[1]))[0])));
    },
  };
}
const names = members => members.map(member => member.name);
const has = (lines, suffix) => lines.some(line => line.endsWith(suffix));

test('A02-T30 a record class declares its synthesized members with the flags Roslyn gives them', () => {
  const { type, method, metadata } = emit(`record Point(int X, int Y);
    sealed record Tag(string Text);
    class C { static int Main() { return new Point(1, 2).X + new Tag("t").Text.Length; } }`);
  const point = type('Point');
  const synthesized = ['get_EqualityContract', 'PrintMembers', '<Clone>$', 'Equals', 'GetHashCode', 'ToString', 'op_Equality', 'op_Inequality', 'Deconstruct'];
  for (const expected of synthesized) {
    assert.ok(names(point.methods).includes(expected), `Point declares ${expected}`);
  }
  assert.deepEqual(names(point.fields), ['<X>k__BackingField', '<Y>k__BackingField']);
  assert.ok(point.fields.every(field => field.flags & FieldAttributes.InitOnly), 'the backing field of an init-only property is initonly');
  const virtualSlot = MethodAttributes.Virtual | MethodAttributes.NewSlot,
    access = flags => flags & MethodAttributes.MemberAccessMask;
  assert.equal(method('Point', 'PrintMembers').flags & virtualSlot, virtualSlot);
  assert.equal(access(method('Point', 'PrintMembers').flags), MethodAttributes.Family);
  assert.equal(method('Point', '<Clone>$').flags & virtualSlot, virtualSlot);
  // Equals(Point) is the first Equals; it fills the slot of IEquatable<Point>.Equals and stays overridable.
  assert.equal(method('Point', 'Equals').flags & (virtualSlot | MethodAttributes.Final), virtualSlot);
  // A sealed record: nothing overrides its members.
  assert.equal(access(method('Tag', 'PrintMembers').flags), MethodAttributes.Private);
  assert.equal(method('Tag', '<Clone>$').flags & MethodAttributes.Virtual, 0);
  assert.equal(method('Tag', 'Equals').flags & MethodAttributes.Final, MethodAttributes.Final);
  const interfaces = (metadata.rows[9] ?? []).map(row => metadata.typeName(decodeCoded('TypeDefOrRef', row[1])));
  assert.deepEqual(interfaces, ['System.IEquatable`1<Point>', 'System.IEquatable`1<Tag>']);
});

test('A02-T30 record equality, hashing and text follow the Roslyn shapes', () => {
  const { lines } = emit(`record Point(int X, string Name);
    class C { static int Main() { return new Point(1, "n") == new Point(1, "n") ? 0 : 1; } }`);
  const equals = lines('Point', 'Equals');
  assert.equal(equals.filter(line => line.endsWith('::get_EqualityContract')).length, 2, 'the contracts of both records are compared');
  assert.ok(has(equals, 'System.Type::op_Equality'));
  assert.ok(equals.includes('call System.Collections.Generic.EqualityComparer`1<int>::get_Default'));
  assert.ok(equals.includes('callvirt System.Collections.Generic.EqualityComparer`1<string>::Equals'));
  assert.deepEqual(lines('Point', 'Equals', 1), ['ldarg.0', 'ldarg.1', 'isinst Point', 'callvirt Point::Equals', 'ret']);
  const hash = lines('Point', 'GetHashCode');
  assert.equal(hash.filter(line => line === 'mul').length, 2, 'one multiplication per field');
  assert.ok(has(lines('Point', 'ToString'), 'Point::PrintMembers'));
  assert.ok(has(lines('Point', 'PrintMembers'), 'System.Text.StringBuilder::Append'));
  assert.deepEqual(lines('Point', 'get_EqualityContract'), ['ldtoken Point', 'call System.Type::GetTypeFromHandle', 'ret']);
  assert.deepEqual(lines('Point', '<Clone>$'), ['ldarg.0', 'newobj Point::.ctor', 'ret']);
  // The primary constructor stores the positional parameters, then calls object().
  const stores = ['ldarg.0', 'ldarg.1', 'stfld Point::<X>k__BackingField', 'ldarg.0', 'ldarg.2', 'stfld Point::<Name>k__BackingField'];
  assert.deepEqual(lines('Point', '.ctor').slice(0, 6), stores);
});

test('A02-T30 a derived record reuses the positional properties of its base and overrides the virtual members', () => {
  const { type, method, lines, attributes, metadata } = emit(`record Point(int X, int Y);
    record Named(string Name, int X, int Y) : Point(X, Y);
    class C { static int Main() { Point p = new Named("n", 1, 2); return (p with { X = 3 }).X; } }`);
  assert.deepEqual(names(type('Named').fields), ['<Name>k__BackingField'], 'X and Y are the properties of Point');
  assert.ok(has(lines('Named', 'PrintMembers'), 'Point::PrintMembers'));
  assert.ok(has(lines('Named', 'GetHashCode'), 'Point::GetHashCode'));
  // Equals(Named), Equals(object), then the sealed override of Equals(Point).
  const equalsBase = type('Named').methods.filter(candidate => candidate.name === 'Equals').find(candidate => candidate.flags & MethodAttributes.Final);
  assert.ok(equalsBase, 'Named seals Equals(Point)');
  // The clone of the derived record is a covariant override: its own slot plus a MethodImpl row.
  const clone = method('Named', '<Clone>$');
  assert.deepEqual(attributes(clone.token), ['System.Runtime.CompilerServices.PreserveBaseOverridesAttribute']);
  assert.ok((metadata.rows[25] ?? []).some(row => decodeCoded('MethodDefOrRef', row[1]) === clone.token), 'a MethodImpl row names the overridden clone');
  const main = lines('C', 'Main');
  assert.ok(main.indexOf('callvirt Point::<Clone>$') >= 0 && main.indexOf('callvirt Point::<Clone>$') < main.indexOf('callvirt Point::set_X'));
});

test('A02-T30 record structs compare their fields and copy by value for with', () => {
  const { lines, type } = emit(`record struct Vector(int Dx, int Dy);
    class C { static int Main() { var v = new Vector(1, 2); var w = v with { Dy = 5 }; return v == w ? 1 : 0; } }`);
  assert.ok(!names(type('Vector').methods).includes('<Clone>$'), 'a struct has no clone method');
  assert.ok(!has(lines('Vector', 'Equals'), '::get_EqualityContract'));
  assert.ok(lines('C', 'Main').includes('call Vector::set_Dy'));
  assert.deepEqual(lines('Vector', 'op_Equality'), ['ldarga.s', 'ldarg.1', 'call Vector::Equals', 'ret']);
});

test('A02-T30 an init accessor returns void modreq(IsExternalInit); required members are attributed', () => {
  const { method, metadata, type, attributes } = emit(`class Account {
      public required string Owner { get; init; }
      public required int Balance;
      public int Level { get; set; }
      public Account() { }
      [System.Diagnostics.CodeAnalysis.SetsRequiredMembers] public Account(string owner) { Owner = owner; }
    }
    class C { static int Main() { return new Account { Owner = "a", Balance = 1 }.Balance; } }`);
  const signature = token => [...metadata.blob(metadata.row(token)[4])];
  const init = signature(method('Account', 'set_Owner').token);
  assert.equal(init[2], CMOD_REQUIRED, 'the return type starts with a required modifier');
  assert.equal(signature(method('Account', 'set_Level').token)[2], 0x01, 'a plain setter returns void');
  const REQUIRED = 'System.Runtime.CompilerServices.RequiredMemberAttribute',
    account = type('Account');
  assert.deepEqual(attributes(account.token), [REQUIRED]);
  assert.deepEqual(attributes(account.fields.find(field => field.name === 'Balance').token), [REQUIRED]);
  const guarded = ['System.ObsoleteAttribute', 'System.Runtime.CompilerServices.CompilerFeatureRequiredAttribute'];
  assert.deepEqual(attributes(method('Account', '.ctor', 0).token), guarded);
  assert.deepEqual(attributes(method('Account', '.ctor', 1).token), ['System.Diagnostics.CodeAnalysis.SetsRequiredMembersAttribute']);
});

test('A02-T30 a generic record names its members through its instantiation; == binds once', () => {
  const { lines } = emit(`record Box<T>(T Value);
    class C { static int Main() { return new Box<int>(1) == new Box<int>(1) ? 0 : 1; } }`);
  assert.ok(lines('C', 'Main').includes('call Box`1<int>::op_Equality'));
  assert.ok(lines('Box`1', 'Equals').includes('call System.Collections.Generic.EqualityComparer`1<!0>::get_Default'));
  assert.ok(lines('Box`1', 'Equals').includes('ldfld Box`1<!0>::<Value>k__BackingField'));
});
