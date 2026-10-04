import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, TypeAttributes, MethodAttributes } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { IlBuilder } from '../packages/compiler/src/emit/cil/il-builder.js';
import { slotsAcrossSuspensions, rewriteHoistedSlots } from '../packages/compiler/src/emit/cil/state-machine-hoisting.js';

// SF-A02-T30: iterators emitted as CIL state machine classes from bound trees. The fixture `iterators`
// (packages/compiler/test/cil-emission) runs them end to end against the Roslyn build on real .NET (SDK 10.0.201);
// these tests pin the class an iterator becomes, its kickoff, `MoveNext` and which locals become fields.

const METHOD_IMPL = 25;

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
    methodOf,
    body: (owner, name) => inspector.getMethod(methodOf(owner, name).token),
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
const has = (flags, mask) => (flags & mask) === mask;
const fieldNames = type => type.fields.map(field => field.name);

const counting = `using System.Collections.Generic;
  class C {
    static IEnumerable<int> Count(int limit) {
      int doubled = limit * 2;
      System.Console.WriteLine(doubled);
      for (int i = 0; i < limit; i++) yield return i * i;
    }
    static void Main() { }
  }`;

test('A02-T30 an iterator is a sealed nested class implementing the enumerable and enumerator interfaces', () => {
  const { type, inspector } = emit(counting),
    machine = type('C+<Count>d__0');
  assert.equal(machine.flags & TypeAttributes.VisibilityMask, TypeAttributes.NestedPrivate);
  assert.ok(has(machine.flags, TypeAttributes.Sealed));
  // InterfaceImpl rows are sorted by the interface token, not in declaration order.
  assert.deepEqual(machine.interfaces.map(token => inspector.metadata.typeName(token)).sort(), [
    'System.Collections.Generic.IEnumerable`1<int>',
    'System.Collections.Generic.IEnumerator`1<int>',
    'System.Collections.IEnumerable',
    'System.Collections.IEnumerator',
    'System.IDisposable',
  ]);
  assert.deepEqual(
    machine.methods.map(method => method.name),
    [
      '.ctor',
      'System.IDisposable.Dispose',
      'MoveNext',
      'System.Collections.Generic.IEnumerator<System.Int32>.get_Current',
      'System.Collections.IEnumerator.Reset',
      'System.Collections.IEnumerator.get_Current',
      'System.Collections.Generic.IEnumerable<System.Int32>.GetEnumerator',
      'System.Collections.IEnumerable.GetEnumerator',
    ],
  );
  const implementation = MethodAttributes.Private | MethodAttributes.Final | MethodAttributes.Virtual | MethodAttributes.NewSlot;
  for (const method of machine.methods.slice(1)) assert.ok(has(method.flags, implementation), method.name);
  // One MethodImpl row per interface member: each names the slot the private method fills.
  const slots = inspector.metadata.rows[METHOD_IMPL].map(row => {
    // MethodDeclaration is a MethodDefOrRef coded index: the low bit selects MemberRef (table 0x0a).
    const coded = row[2],
      declaration = inspector.resolveToken((((coded & 1 ? 0x0a : 0x06) << 24) | (coded >> 1)) >>> 0);
    return `${declaration.owner}::${declaration.name}`;
  });
  assert.deepEqual(slots, [
    'System.IDisposable::Dispose',
    'System.Collections.IEnumerator::MoveNext',
    'System.Collections.Generic.IEnumerator`1<int>::get_Current',
    'System.Collections.IEnumerator::Reset',
    'System.Collections.IEnumerator::get_Current',
    'System.Collections.Generic.IEnumerable`1<int>::GetEnumerator',
    'System.Collections.IEnumerable::GetEnumerator',
  ]);
});

test('A02-T30 the kickoff creates the machine in state -2 and hands it the arguments', () => {
  const { lines } = emit(counting);
  assert.deepEqual(lines('C', 'Count'), [
    'ldc.i4.s',
    'newobj C+<Count>d__0::.ctor',
    'dup',
    'ldarg.0',
    'stfld C+<Count>d__0::<>3__limit',
    'ret',
  ]);
  assert.deepEqual(lines('C+<Count>d__0', '.ctor'), [
    'ldarg.0',
    'call System.Object::.ctor',
    'ldarg.0',
    'ldarg.1',
    'stfld C+<Count>d__0::<>1__state',
    'ldarg.0',
    'call System.Environment::get_CurrentManagedThreadId',
    'stfld C+<Count>d__0::<>l__initialThreadId',
    'ret',
  ]);
});

test('A02-T30 GetEnumerator reuses the enumerable on the thread that created it, once', () => {
  const { lines } = emit(counting),
    body = lines('C+<Count>d__0', 'System.Collections.Generic.IEnumerable<System.Int32>.GetEnumerator');
  assert.deepEqual(body.slice(0, 8), [
    'ldarg.0',
    'ldfld C+<Count>d__0::<>1__state',
    'ldc.i4.s',
    'bne.un.s',
    'ldarg.0',
    'ldfld C+<Count>d__0::<>l__initialThreadId',
    'call System.Environment::get_CurrentManagedThreadId',
    'bne.un.s',
  ]);
  assert.ok(body.includes('newobj C+<Count>d__0::.ctor'), 'another enumeration gets a new machine');
  const copy = body.indexOf('ldfld C+<Count>d__0::<>3__limit');
  assert.equal(body[copy + 1], 'stfld C+<Count>d__0::limit', 'every enumerator starts from the original argument');
  assert.deepEqual(lines('C+<Count>d__0', 'System.Collections.IEnumerable.GetEnumerator'), [
    'ldarg.0',
    'call C+<Count>d__0::System.Collections.Generic.IEnumerable<System.Int32>.GetEnumerator',
    'ret',
  ]);
});

test('A02-T30 MoveNext dispatches on the state; a local that lives across a yield is a field, another stays a local', () => {
  const { lines, type, body } = emit(counting),
    moveNext = lines('C+<Count>d__0', 'MoveNext');
  assert.deepEqual(moveNext.slice(0, 3), ['ldarg.0', 'ldfld C+<Count>d__0::<>1__state', 'switch']);
  assert.deepEqual(fieldNames(type('C+<Count>d__0')), ['<>1__state', '<>2__current', '<>l__initialThreadId', 'limit', '<>3__limit', '<i>5__1']);
  assert.ok(moveNext.includes('ldfld C+<Count>d__0::<i>5__1'));
  assert.ok(moveNext.includes('ldfld C+<Count>d__0::limit'), 'a parameter is read from its field');
  // `doubled` is written and read before the first suspension point: it stays a local of MoveNext.
  assert.ok(moveNext.includes('stloc.0') && moveNext.includes('ldloc.0'));
  const yielded = moveNext.indexOf('stfld C+<Count>d__0::<>2__current');
  assert.deepEqual(moveNext.slice(yielded + 1, yielded + 6), ['ldarg.0', 'ldc.i4.1', 'stfld C+<Count>d__0::<>1__state', 'ldc.i4.1', 'ret']);
  assert.deepEqual(moveNext.slice(yielded + 6, yielded + 9), ['ldarg.0', 'ldc.i4.m1', 'stfld C+<Count>d__0::<>1__state'], 'resumed: running again');
  assert.deepEqual(moveNext.slice(-2), ['ldc.i4.0', 'ret'], 'the end of the body returns false');
  assert.equal(body('C+<Count>d__0', 'MoveNext').handlers.length, 0);
});

test('A02-T30 Reset throws, Current reads the field, and the untyped Current boxes a value', () => {
  const { lines } = emit(counting),
    machine = 'C+<Count>d__0';
  assert.deepEqual(lines(machine, 'System.Collections.IEnumerator.Reset'), ['newobj System.NotSupportedException::.ctor', 'throw']);
  assert.deepEqual(lines(machine, 'System.Collections.Generic.IEnumerator<System.Int32>.get_Current'), ['ldarg.0', `ldfld ${machine}::<>2__current`, 'ret']);
  assert.deepEqual(lines(machine, 'System.Collections.IEnumerator.get_Current'), ['ldarg.0', `ldfld ${machine}::<>2__current`, 'box System.Int32', 'ret']);
  assert.deepEqual(lines(machine, 'System.IDisposable.Dispose'), ['ldarg.0', 'ldc.i4.s', `stfld ${machine}::<>1__state`, 'ret']);
});

test('A02-T30 a yield inside try-finally keeps the region: its start dispatches, the finally block skips itself on suspension', () => {
  const { lines, body, type } = emit(`using System; using System.Collections.Generic;
    class C {
      static IEnumerable<int> Guarded() {
        try { yield return 1; yield return 2; }
        finally { Console.WriteLine("done"); }
      }
      static void Main() { }
    }`),
    machine = 'C+<Guarded>d__0',
    moveNext = body(machine, 'MoveNext'),
    text = lines(machine, 'MoveNext'),
    offsets = moveNext.instructions.map(instruction => instruction.offset),
    [region] = moveNext.handlers,
    at = offset => offsets.indexOf(offset);
  assert.equal(moveNext.handlers.length, 1);
  assert.equal(region.kind, 'finally');
  assert.deepEqual(
    text.slice(at(region.start), at(region.start) + 5),
    ['ldarg.0', `ldfld ${machine}::<>1__state`, 'ldc.i4.1', 'sub', 'switch'],
    'the region is entered at its first instruction, which sends a resumed state on',
  );
  assert.deepEqual(
    text.slice(at(region.target), at(region.target) + 4),
    ['ldarg.0', `ldfld ${machine}::<>1__state`, 'ldc.i4.m1', 'bne.un.s'],
    'the finally block runs only while the method is running, not while it leaves to suspend',
  );
  assert.ok(text.slice(at(region.start), at(region.end)).some(line => line.startsWith('leave')), 'a yield leaves the region to return');
  assert.ok(fieldNames(type(machine)).includes('<>w__disposeMode'));
  assert.deepEqual(lines(machine, 'System.IDisposable.Dispose'), [
    'ldarg.0',
    `ldfld ${machine}::<>1__state`,
    'ldc.i4.0',
    'ble.s',
    'ldarg.0',
    'ldc.i4.1',
    `stfld ${machine}::<>w__disposeMode`,
    'ldarg.0',
    `call ${machine}::MoveNext`,
    'pop',
    'ldarg.0',
    'ldc.i4.0',
    `stfld ${machine}::<>w__disposeMode`,
    'ldarg.0',
    'ldc.i4.s',
    `stfld ${machine}::<>1__state`,
    'ret',
  ]);
});

test('A02-T30 a try without a yield in an iterator is an ordinary region', () => {
  const { lines, body } = emit(`using System; using System.Collections.Generic;
    class C {
      static IEnumerable<int> Guarded() {
        try { Console.WriteLine("work"); } finally { Console.WriteLine("done"); }
        yield return 1;
      }
      static void Main() { }
    }`),
    text = lines('C+<Guarded>d__0', 'MoveNext');
  assert.equal(body('C+<Guarded>d__0', 'MoveNext').handlers.length, 1);
  assert.equal(text.filter(line => line === 'switch').length, 1, 'only the dispatch at the start of MoveNext');
  assert.ok(!text.some(line => line.startsWith('bne.un')), 'the finally block is not guarded');
});

test('A02-T30 an iterator that returns an enumerator starts in state 0 and has no enumerable half', () => {
  const { lines, type } = emit(`using System.Collections.Generic;
    class C {
      int seed = 3;
      IEnumerator<int> Values(int count) { for (int i = 0; i < count; i++) yield return seed + i; }
      static void Main() { }
    }`),
    machine = type('C+<Values>d__0');
  assert.deepEqual(fieldNames(machine), ['<>1__state', '<>2__current', 'count', '<>4__this', '<i>5__1']);
  assert.ok(!machine.methods.some(method => method.name.endsWith('GetEnumerator')));
  assert.deepEqual(lines('C', 'Values'), [
    'ldc.i4.0',
    'newobj C+<Values>d__0::.ctor',
    'dup',
    'ldarg.0',
    'stfld C+<Values>d__0::<>4__this',
    'dup',
    'ldarg.1',
    'stfld C+<Values>d__0::count',
    'ret',
  ]);
  const moveNext = lines('C+<Values>d__0', 'MoveNext'),
    receiver = moveNext.indexOf('ldfld C+<Values>d__0::<>4__this');
  assert.equal(moveNext[receiver + 1], 'ldfld C::seed', '`this` in the body is the object the kickoff ran on');
});

// Hoisting works on the instruction stream alone; these streams stand for bodies with the given control flow.
function stream(build) {
  const il = new IlBuilder(),
    resumes = new Set(),
    resume = () => {
      const label = il.newLabel();
      il.emit('ldc.i4', 1).emit('ret', undefined, { pops: 1, pushes: 0 });
      il.mark(label, 0);
      resumes.add(label);
    },
    slot = () => il.declareLocal({ name: 'int' });
  build(il, { resume, slot });
  il.emit('ldc.i4', 0).emit('ret', undefined, { pops: 1, pushes: 0 });
  return { il, hoisted: [...slotsAcrossSuspensions(il, resumes)].sort() };
}

test('A02-T30 hoisting: a slot is a field only when a resume point lies between its uses', () => {
  const { hoisted } = stream((il, { resume, slot }) => {
    const before = slot(),
      across = slot(),
      after = slot();
    il.emit('ldc.i4', 1).emit('stloc', before).emit('ldloc', before).emit('pop');
    il.emit('ldc.i4', 2).emit('stloc', across);
    resume();
    il.emit('ldloc', across).emit('pop');
    il.emit('ldc.i4', 3).emit('stloc', after).emit('ldloc', after).emit('pop');
  });
  assert.deepEqual(hoisted, [1]);
});

test('A02-T30 hoisting: every slot used in a loop that contains a resume point is a field', () => {
  const { hoisted } = stream((il, { resume, slot }) => {
    const carried = slot(),
      outside = slot(),
      top = il.newLabel();
    il.emit('ldc.i4', 0).emit('stloc', outside).emit('ldloc', outside).emit('pop');
    il.mark(top);
    // Read first, written after the suspension: the value comes from the previous round.
    resume();
    il.emit('ldloc', carried).emit('ldc.i4', 1).emit('add').emit('stloc', carried);
    il.emit('ldloc', carried).emit('ldc.i4', 9).emit('blt', top);
  });
  assert.deepEqual(hoisted, [0]);
});

test('A02-T30 hoisting: loads, stores and addresses of a hoisted slot go through the field', () => {
  const il = new IlBuilder(),
    slot = il.declareLocal({ name: 'int' }),
    kept = il.declareLocal({ name: 'int' });
  il.emit('ldc.i4', 5).emit('stloc', slot).emit('ldloc', slot).emit('stloc', kept).emit('ldloca', slot).emit('pop');
  il.emit('ret', undefined, { pops: 0, pushes: 0 });
  const depth = il.maxDepth;
  rewriteHoistedSlots(il, new Map([[slot, 0x04000007]]));
  assert.deepEqual(
    il.instructions.map(instruction => `${instruction.name} ${instruction.operand ?? ''}`.trim()),
    ['ldc.i4 5', 'stloc 0', 'ldarg 0', 'ldloc 0', 'stfld 67108871', 'ldarg 0', 'ldfld 67108871', 'stloc 1', 'ldarg 0', 'ldflda 67108871', 'pop', 'ret'],
  );
  assert.equal(il.maxDepth, depth + 1);
});
