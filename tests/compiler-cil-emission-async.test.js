import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, TypeAttributes } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { TypedIlBuilder } from '../packages/compiler/src/emit/cil/il-stack-types.js';

// SF-A02-T30: async methods emitted as CIL state machines from bound trees. The fixture `async`
// (packages/compiler/test/cil-emission) runs them end to end against the Roslyn build on real .NET (SDK 10.0.201);
// these tests pin the class an async method becomes, its kickoff, `MoveNext`, the await sequence, the saved stack,
// the rewritten handlers and the entry point of an async `Main`.

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
const refused = source => {
  const result = compileToAssembly(source, { name: 'Sample' });
  assert.equal(result.assembly, null);
  return result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
};
const fieldNames = type => type.fields.map(field => field.name);
const BUILDER = 'System.Runtime.CompilerServices.AsyncTaskMethodBuilder`1<int>';
const AWAITER = 'System.Runtime.CompilerServices.TaskAwaiter`1<int>';

const adding = `using System.Threading.Tasks;
  class C {
    static int Trace(int v) { return v; }
    static async Task<int> Add(Task<int> source, int extra) { return Trace(extra) + await source; }
    static void Main() { }
  }`;

test('A02-T30 an async method is a sealed nested class implementing IAsyncStateMachine', () => {
  const { type, inspector } = emit(adding),
    machine = type('C+<Add>d__0');
  assert.equal(machine.flags & TypeAttributes.VisibilityMask, TypeAttributes.NestedPrivate);
  assert.deepEqual(
    machine.interfaces.map(token => inspector.metadata.typeName(token)),
    ['System.Runtime.CompilerServices.IAsyncStateMachine'],
  );
  assert.deepEqual(
    machine.methods.map(method => method.name),
    ['.ctor', 'MoveNext', 'SetStateMachine'],
  );
  // The awaiter field and the saved operand are added while MoveNext is emitted.
  assert.deepEqual(fieldNames(machine), ['<>1__state', '<>t__builder', 'source', 'extra', '<>u__1', '<>7__wrap1']);
});

test('A02-T30 the kickoff creates the machine, starts it through the builder and returns the builder task', () => {
  const { lines } = emit(adding),
    machine = 'C+<Add>d__0';
  assert.deepEqual(lines('C', 'Add'), [
    `newobj ${machine}::.ctor`,
    'stloc.0',
    'ldloc.0',
    `call ${BUILDER}::Create`,
    `stfld ${machine}::<>t__builder`,
    'ldloc.0',
    'ldarg.0',
    `stfld ${machine}::source`,
    'ldloc.0',
    'ldarg.1',
    `stfld ${machine}::extra`,
    'ldloc.0',
    'ldc.i4.m1',
    `stfld ${machine}::<>1__state`,
    'ldloc.0',
    `ldflda ${machine}::<>t__builder`,
    'ldloca.s',
    `call ${BUILDER}::Start`,
    'ldloc.0',
    `ldflda ${machine}::<>t__builder`,
    `call ${BUILDER}::get_Task`,
    'ret',
  ]);
});

test('A02-T30 MoveNext runs the body in a try whose catch hands the exception to the builder', () => {
  const { lines, body, inspector } = emit(adding),
    machine = 'C+<Add>d__0',
    moveNext = body(machine, 'MoveNext'),
    text = lines(machine, 'MoveNext'),
    offsets = moveNext.instructions.map(instruction => instruction.offset),
    [region] = moveNext.handlers,
    at = offset => offsets.indexOf(offset);
  assert.equal(moveNext.handlers.length, 1);
  assert.equal(region.kind, 'catch');
  assert.equal(inspector.metadata.typeName(region.catchType), 'System.Exception');
  assert.equal(region.start, 0, 'the region starts with the dispatch on the state');
  assert.deepEqual(text.slice(0, 3), ['ldarg.0', `ldfld ${machine}::<>1__state`, 'switch']);
  assert.deepEqual(text.slice(at(region.target), at(region.handlerEnd)), [
    'stloc.0',
    'ldarg.0',
    'ldc.i4.s',
    `stfld ${machine}::<>1__state`,
    'ldarg.0',
    `ldflda ${machine}::<>t__builder`,
    'ldloc.0',
    `call ${BUILDER}::SetException`,
    'leave.s',
  ]);
  assert.deepEqual(text.slice(at(region.handlerEnd)), [
    'ldarg.0',
    'ldc.i4.s',
    `stfld ${machine}::<>1__state`,
    'ldarg.0',
    `ldflda ${machine}::<>t__builder`,
    'ldloc.1',
    `call ${BUILDER}::SetResult`,
    'ret',
  ]);
  assert.deepEqual(lines(machine, 'SetStateMachine'), ['ret']);
});

test('A02-T30 an await suspends through the builder and resumes from the awaiter field', () => {
  const { lines } = emit(adding),
    machine = 'C+<Add>d__0',
    text = lines(machine, 'MoveNext'),
    start = text.indexOf('callvirt System.Threading.Tasks.Task`1<int>::GetAwaiter');
  assert.deepEqual(text.slice(start, start + 23), [
    'callvirt System.Threading.Tasks.Task`1<int>::GetAwaiter',
    'stloc.3',
    'ldloca.s',
    `call ${AWAITER}::get_IsCompleted`,
    'brtrue.s',
    'ldarg.0',
    'ldc.i4.0',
    `stfld ${machine}::<>1__state`,
    'ldarg.0',
    'ldloc.3',
    `stfld ${machine}::<>u__1`,
    'ldarg.0',
    'stloc.s',
    'ldarg.0',
    `ldflda ${machine}::<>t__builder`,
    'ldloca.s',
    'ldloca.s',
    `call ${BUILDER}::AwaitUnsafeOnCompleted`,
    'leave.s',
    'ldarg.0',
    'ldc.i4.m1',
    `stfld ${machine}::<>1__state`,
    'ldarg.0',
  ]);
  assert.deepEqual(text.slice(start + 23, start + 30), [
    `ldfld ${machine}::<>u__1`,
    'stloc.3',
    'ldarg.0',
    `ldflda ${machine}::<>u__1`,
    `initobj ${AWAITER}`,
    'ldloca.s',
    `call ${AWAITER}::GetResult`,
  ]);
});

test('A02-T30 an operand evaluated before an await is saved in a field and pushed again after it', () => {
  const { lines } = emit(adding),
    machine = 'C+<Add>d__0',
    text = lines(machine, 'MoveNext'),
    traced = text.indexOf('call C::Trace'),
    awaited = text.indexOf('callvirt System.Threading.Tasks.Task`1<int>::GetAwaiter'),
    result = text.indexOf(`call ${AWAITER}::GetResult`);
  assert.ok(traced < awaited, 'the left operand is evaluated first');
  assert.ok(text.slice(traced, awaited).includes(`stfld ${machine}::<>7__wrap1`), 'and leaves the stack before the await');
  assert.deepEqual(text.slice(result + 1, result + 6), ['stloc.s', 'ldarg.0', `ldfld ${machine}::<>7__wrap1`, 'ldloc.s', 'add']);
});

test('A02-T30 the return type selects the method builder', () => {
  const { lines } = emit(`using System.Threading.Tasks;
    class C {
      static async Task Plain() { await Task.Delay(1); }
      static async void Fire() { await Task.Delay(1); }
      static async ValueTask Quick() { await Task.Delay(1); }
      static async ValueTask<long> Wide() { await Task.Delay(1); return 1L; }
      static void Main() { }
    }`),
    created = name => lines('C', name).find(line => line.endsWith('::Create')),
    services = 'System.Runtime.CompilerServices.';
  assert.equal(created('Plain'), `call ${services}AsyncTaskMethodBuilder::Create`);
  assert.equal(created('Fire'), `call ${services}AsyncVoidMethodBuilder::Create`);
  assert.equal(created('Quick'), `call ${services}AsyncValueTaskMethodBuilder::Create`);
  assert.equal(created('Wide'), `call ${services}AsyncValueTaskMethodBuilder\`1<long>::Create`);
  assert.equal(lines('C', 'Fire').at(-2), `call ${services}AsyncVoidMethodBuilder::Start`, 'async void returns nothing: no get_Task');
});

test('A02-T30 Task.Yield and the awaitable pattern use their own awaiters', () => {
  const { lines } = emit(`using System; using System.Runtime.CompilerServices; using System.Threading.Tasks;
    class Signal { public Waiter GetAwaiter() { return new Waiter(); } }
    class Waiter : INotifyCompletion {
      public bool IsCompleted { get { return true; } }
      public int GetResult() { return 1; }
      public void OnCompleted(Action continuation) { continuation(); }
    }
    class C {
      static async Task<int> Run(Signal signal) { await Task.Yield(); return await signal; }
      static void Main() { }
    }`),
    text = lines('C+<Run>d__0', 'MoveNext'),
    services = 'System.Runtime.CompilerServices.';
  assert.ok(text.includes('call System.Threading.Tasks.Task::Yield'));
  assert.ok(text.includes(`call ${services}YieldAwaitable::GetAwaiter`));
  assert.ok(text.includes(`call ${services}YieldAwaitable+YieldAwaiter::get_IsCompleted`));
  assert.ok(text.includes('callvirt Signal::GetAwaiter'));
  assert.ok(text.includes('callvirt Waiter::get_IsCompleted'));
  assert.ok(text.includes('callvirt Waiter::GetResult'));
  // A class awaiter that only implements INotifyCompletion is scheduled with AwaitOnCompleted, and its field is cleared with null.
  assert.ok(text.includes(`call ${services}AsyncTaskMethodBuilder\`1<int>::AwaitOnCompleted`));
  const restored = text.lastIndexOf('ldfld C+<Run>d__0::<>u__2');
  assert.deepEqual(text.slice(restored + 2, restored + 5), ['ldarg.0', 'ldnull', 'stfld C+<Run>d__0::<>u__2']);
});

test('A02-T30 an async Main gets the entry point <Main>, which waits for its task', () => {
  const { lines, methodOf, inspector } = emit(`using System.Threading.Tasks;
    class C { static async Task<int> Main(string[] args) { await Task.Delay(1); return args.Length; } }`);
  assert.deepEqual(lines('C', '<Main>'), [
    'ldarg.0',
    'call C::Main',
    'callvirt System.Threading.Tasks.Task`1<int>::GetAwaiter',
    'stloc.0',
    'ldloca.s',
    `call ${AWAITER}::GetResult`,
    'ret',
  ]);
  assert.equal(inspector.pe.entryPoint, methodOf('C', '<Main>').token);
});

test('A02-T30 top-level statements that await become an async <Main>$ behind the entry point <Main>', () => {
  const { lines, type } = emit(`using System; using System.Threading.Tasks;
    await Task.Delay(1);
    Console.WriteLine("done");`);
  assert.ok(lines('Program', '<Main>$').some(line => line.endsWith('AsyncTaskMethodBuilder::Start')));
  assert.deepEqual(lines('Program', '<Main>').slice(0, 2), ['ldarg.0', 'call Program::<Main>$'], 'the arguments are passed on');
  assert.ok(type('Program+<<Main>$>d__0'));
});

test('A02-T30 an await in a finally block moves the block behind a catch-all; an await in a catch moves the handler', () => {
  const { lines, body, inspector } = emit(`using System; using System.Threading.Tasks;
    class C {
      static async Task<int> Guarded(Task<int> source) {
        try { return await source; }
        catch (InvalidOperationException) { await Task.Delay(1); throw; }
        finally { await Task.Delay(2); }
      }
      static void Main() { }
    }`),
    machine = 'C+<Guarded>d__0',
    moveNext = body(machine, 'MoveNext'),
    text = lines(machine, 'MoveNext'),
    caught = moveNext.handlers.map(handler => `${handler.kind} ${inspector.metadata.typeName(handler.catchType)}`);
  // Innermost first: the recording clause, the catch-all that stands for the finally block, the method's own handler.
  assert.deepEqual(caught, ['catch System.InvalidOperationException', 'catch System.Object', 'catch System.Exception']);
  const capture = 'call System.Runtime.ExceptionServices.ExceptionDispatchInfo::Capture';
  assert.equal(text.filter(line => line === capture).length, 2, 'the rethrow in the moved handler and the one after the moved finally block');
  assert.ok(text.includes('callvirt System.Runtime.ExceptionServices.ExceptionDispatchInfo::Throw'));
  assert.ok(!text.includes('rethrow') && !text.includes('endfinally'), 'no handler awaits');
});

test('A02-T30 async constructs the emitter has no shape for yet are SF2200', () => {
  assert.match(
    refused(`using System.Threading.Tasks;
      struct Counter { public int Count; public void Add(int amount) { Count += amount; } }
      class C {
        static async Task Run(Task<int> source) { Counter counter = new Counter(); counter.Add(await source); }
        static void Main() { }
      }`)[0],
    /^SF2200 .*await while a value the emitter cannot save is on the evaluation stack/,
  );
});

test('A02-T30 the typed stream knows what is on the stack, and says when it does not', () => {
  const core = { int: { name: 'int' }, string: { name: 'string' }, object: { name: 'object' } },
    machine = { name: 'machine' },
    cell = { name: 'cell' },
    il = new TypedIlBuilder(core, [machine]),
    slot = il.declareLocal(cell),
    address = il.declareLocal(cell, { isByReference: true }),
    names = () => il.pendingTypes.map(type => type?.name ?? null);
  il.emit('ldarg', 0).emit('ldc.i4', 1).emit('ldstr', 0x70000001).emit('ldloc', slot);
  assert.deepEqual(names(), ['machine', 'int', 'string', 'cell']);
  il.emit('dup').emit('pop').emit('pop');
  assert.deepEqual(names(), ['machine', 'int', 'string']);
  il.emit('call', 0x0a000001, { pops: 2, pushes: 1 });
  assert.deepEqual(names(), ['machine', null], 'a call does not say what it returns');
  il.recordTop(core.object);
  assert.deepEqual(names(), ['machine', 'object'], 'the emitter records the type of the expression it evaluated');
  il.emit('ldloc', address).emit('ldloca', slot);
  assert.deepEqual(names(), ['machine', 'object', null, null], 'a managed pointer cannot be saved');
  il.emit('pop').emit('pop').emit('pop').emit('pop');
  assert.deepEqual(names(), []);
});
