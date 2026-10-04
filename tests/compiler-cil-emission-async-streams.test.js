import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: async iterators, `await foreach` and `await using` emitted as CIL from bound trees. The fixture
// `async-streams` (packages/compiler/test/cil-emission) runs them end to end against the Roslyn build on real .NET
// (SDK 10.0.201); these tests pin the class an async iterator becomes, its fixed members, the two series of states
// of `MoveNext`, and the calls `await foreach` and `await using` make.

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
const SOURCES = 'System.Threading.Tasks.Sources.';
const PROMISE = SOURCES + 'ManualResetValueTaskSourceCore`1<bool>';
const BUILDER = 'System.Runtime.CompilerServices.AsyncIteratorMethodBuilder';

const numbers = `using System.Collections.Generic; using System.Threading.Tasks;
  class C {
    static async IAsyncEnumerable<int> Numbers(int count) {
      for (int i = 0; i < count; i++) { await Task.Delay(1); yield return i; }
    }
    static void Main() { }
  }`;

test('A02-T30 an async iterator implements the async-stream, value-task-source and state-machine interfaces', () => {
  const { type, inspector } = emit(numbers),
    machine = type('C+<Numbers>d__0');
  assert.deepEqual(machine.interfaces.map(token => inspector.metadata.typeName(token)).sort(), [
    'System.Collections.Generic.IAsyncEnumerable`1<int>',
    'System.Collections.Generic.IAsyncEnumerator`1<int>',
    'System.IAsyncDisposable',
    'System.Runtime.CompilerServices.IAsyncStateMachine',
    SOURCES + 'IValueTaskSource',
    SOURCES + 'IValueTaskSource`1<bool>',
  ]);
  assert.deepEqual(
    machine.fields.map(field => field.name),
    [
      '<>1__state',
      '<>t__builder',
      '<>v__promiseOfValueOrEnd',
      '<>2__current',
      '<>w__disposeMode',
      '<>l__initialThreadId',
      'count',
      '<>3__count',
      '<>u__1',
      '<i>5__1',
    ],
  );
  assert.deepEqual(
    machine.methods.map(method => method.name),
    [
      '.ctor',
      'MoveNext',
      'SetStateMachine',
      'MoveNextAsync',
      'get_Current',
      'DisposeAsync',
      'GetResult',
      SOURCES + 'IValueTaskSource.GetResult',
      'GetStatus',
      'OnCompleted',
      'GetAsyncEnumerator',
    ],
  );
});

test('A02-T30 the kickoff creates the machine in state -2; its constructor creates the builder', () => {
  const { lines } = emit(numbers),
    machine = 'C+<Numbers>d__0';
  assert.deepEqual(lines('C', 'Numbers'), ['ldc.i4.s', `newobj ${machine}::.ctor`, 'dup', 'ldarg.0', `stfld ${machine}::<>3__count`, 'ret']);
  assert.deepEqual(lines(machine, '.ctor').slice(-4), ['ldarg.0', `call ${BUILDER}::Create`, `stfld ${machine}::<>t__builder`, 'ret']);
});

test('A02-T30 MoveNextAsync runs MoveNext through the builder and answers with the promise', () => {
  const { lines } = emit(numbers),
    machine = 'C+<Numbers>d__0',
    text = lines(machine, 'MoveNextAsync');
  assert.deepEqual(text.slice(0, 4), ['ldarg.0', `ldfld ${machine}::<>1__state`, 'ldc.i4.s', 'bne.un.s'], 'a finished enumerator answers false');
  assert.ok(text.includes(`call ${PROMISE}::Reset`));
  assert.ok(text.includes(`call ${BUILDER}::MoveNext`));
  assert.ok(text.includes(`call ${PROMISE}::GetStatus`));
  assert.deepEqual(
    text.filter(line => line.startsWith('newobj')),
    ['newobj System.Threading.Tasks.ValueTask`1<bool>::.ctor', 'newobj System.Threading.Tasks.ValueTask`1<bool>::.ctor'],
    'the completed result, or the machine as the source of the pending one',
  );
  const dispose = lines(machine, 'DisposeAsync');
  assert.ok(dispose.includes('newobj System.NotSupportedException::.ctor'), 'a running enumerator cannot be disposed');
  assert.ok(dispose.includes(`stfld ${machine}::<>w__disposeMode`));
  assert.equal(dispose.at(-2), 'newobj System.Threading.Tasks.ValueTask::.ctor');
});

test('A02-T30 MoveNext dispatches awaits from 0 and yields from -4, and completes the promise', () => {
  const { lines, body, inspector } = emit(numbers),
    machine = 'C+<Numbers>d__0',
    text = lines(machine, 'MoveNext'),
    moveNext = body(machine, 'MoveNext');
  assert.deepEqual(text.slice(0, 10), [
    'ldarg.0',
    `ldfld ${machine}::<>1__state`,
    'ldc.i4.0',
    'sub',
    'switch',
    'ldc.i4.s',
    'ldarg.0',
    `ldfld ${machine}::<>1__state`,
    'sub',
    'switch',
  ]);
  const constants = moveNext.instructions.filter(instruction => instruction.name === 'ldc.i4.s').map(instruction => instruction.operand);
  assert.ok(constants.includes(-4), 'the state of the first yield return');
  assert.ok(text.includes(`call ${BUILDER}::AwaitUnsafeOnCompleted`), 'an await suspends through the iterator builder');
  const results = text.filter(line => line === `call ${PROMISE}::SetResult`);
  assert.equal(results.length, 2, 'true at a yield return, false at the end');
  assert.ok(text.includes(`call ${PROMISE}::SetException`));
  assert.ok(text.includes(`call ${BUILDER}::Complete`));
  assert.equal(moveNext.handlers.length, 1);
  assert.equal(inspector.metadata.typeName(moveNext.handlers[0].catchType), 'System.Exception');
});

test('A02-T30 await foreach over the interface passes the default token and disposes the enumerator after the loop', () => {
  const { lines } = emit(`using System; using System.Collections.Generic; using System.Threading.Tasks;
    class C {
      static async Task Run(IAsyncEnumerable<string> source) { await foreach (string item in source) Console.WriteLine(item); }
      static void Main() { }
    }`),
    text = lines('C+<Run>d__0', 'MoveNext'),
    enumerator = 'System.Collections.Generic.IAsyncEnumerator`1<string>',
    getEnumerator = text.indexOf('callvirt System.Collections.Generic.IAsyncEnumerable`1<string>::GetAsyncEnumerator');
  assert.ok(getEnumerator > 0);
  assert.equal(text[getEnumerator - 2], 'initobj System.Threading.CancellationToken', 'GetAsyncEnumerator(default)');
  assert.ok(text.includes(`callvirt ${enumerator}::MoveNextAsync`));
  assert.ok(text.includes(`callvirt ${enumerator}::get_Current`));
  assert.ok(text.includes('call System.Threading.Tasks.ValueTask`1<bool>::GetAwaiter'));
  const dispose = text.indexOf('callvirt System.IAsyncDisposable::DisposeAsync');
  assert.ok(dispose > text.indexOf(`callvirt ${enumerator}::MoveNextAsync`), 'DisposeAsync is awaited after the loop');
  assert.ok(text.includes('call System.Runtime.ExceptionServices.ExceptionDispatchInfo::Capture'), 'an exception from the loop is rethrown after it');
});

test('A02-T30 await using awaits DisposeAsync of each resource, the last one first', () => {
  const { lines } = emit(`using System; using System.Threading.Tasks;
    class Resource : IAsyncDisposable { public ValueTask DisposeAsync() { return default(ValueTask); } }
    class Handle : IAsyncDisposable { public ValueTask DisposeAsync() { return default(ValueTask); } }
    class C {
      static async Task Run() { await using (Resource resource = new Resource()) { await using var handle = new Handle(); Console.WriteLine("body"); } }
      static void Main() { }
    }`),
    text = lines('C+<Run>d__0', 'MoveNext'),
    handle = text.indexOf('callvirt Handle::DisposeAsync'),
    resource = text.indexOf('callvirt Resource::DisposeAsync');
  assert.ok(handle > 0 && resource > handle, 'the inner resource is disposed first; each through the DisposeAsync its type declares');
  assert.equal(text.filter(line => line === 'call System.Threading.Tasks.ValueTask::GetAwaiter').length, 2, 'both disposals are awaited');
  assert.ok(!text.includes('endfinally'), 'a block that awaits is not a finally handler');
});

test('A02-T30 a call of IAsyncEnumerable<T>.GetAsyncEnumerator names the real signature', () => {
  const { lines } = emit(`using System.Collections.Generic; using System.Threading.Tasks;
    class C {
      static async Task<bool> First(IAsyncEnumerable<int> source) { IAsyncEnumerator<int> e = source.GetAsyncEnumerator(); return await e.MoveNextAsync(); }
      static void Main() { }
    }`),
    text = lines('C+<First>d__0', 'MoveNext');
  assert.ok(text.includes('callvirt System.Collections.Generic.IAsyncEnumerable`1<int>::GetAsyncEnumerator'));
  // The symbol table declares the method without its CancellationToken parameter; the call supplies the default.
  const call = text.indexOf('callvirt System.Collections.Generic.IAsyncEnumerable`1<int>::GetAsyncEnumerator');
  assert.deepEqual(text.slice(call - 3, call - 1), ['ldloca.s', 'initobj System.Threading.CancellationToken']);
  assert.match(text[call - 1], /^ldloc/);
});
