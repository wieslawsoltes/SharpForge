import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {ManagedInvocationSession} from '@sharpforge/runtime';

const source = `using System;
using System.Threading.Tasks;
class Entry {
  static int count;
  public static void Main() { }
  public static int Next() { count++; Console.WriteLine(count); return count; }
  public static async Task<int> AsyncValue() { await Task.Delay(1); return count; }
  public static async Task AsyncFailure() { await Task.Delay(1); throw new Exception("async failure"); }
  public static void Loop() { while (true) { count++; } }
}`;

for (const backend of ['source', 'cil']) {
  test(`A23 T39 ${backend} invocation sessions preserve in-session state and isolate independent heaps`, async () => {
    const result = compileToIL(source);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    const artifact = backend === 'cil' ? result.assembly : result.image;
    const session = new ManagedInvocationSession(artifact, {backend, entryPoint: 'Entry.Main'});
    const other = new ManagedInvocationSession(artifact, {backend, entryPoint: 'Entry.Main'});
    try {
      assert.equal((await session.invoke('Entry.Next')).value, 1);
      const second = await session.invoke('Entry.Next');
      assert.equal(second.value, 2);
      assert.equal(second.stdout, '2\n');
      assert.equal((await other.invoke('Entry.Next')).value, 1);
      assert.equal((await session.invoke('Entry.AsyncValue')).value, 2);
      assert.match((await session.invoke('Entry.AsyncFailure')).fault.message, /async failure/);
      assert.equal((await session.invoke('Entry.Next')).value, 3);
    } finally { session.dispose(); other.dispose(); }
    await assert.rejects(session.invoke('Entry.Next'), /disposed/);
  });

  test(`A23 T39 ${backend} rejects invalid arguments and enforces instruction limits`, async () => {
    const result = compileToIL(source);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    const session = new ManagedInvocationSession(backend === 'cil' ? result.assembly : result.image,
      {backend, entryPoint: 'Entry.Main', maxInstructions: 500});
    try {
      await assert.rejects(session.invoke('Missing'), /missing or ambiguous/);
      await assert.rejects(session.invoke('Entry.Next', {arguments: [1]}), /count mismatch/);
      const run = await session.invoke('Entry.Loop');
      assert.match(run.fault.name, /LimitException/);
    } finally { session.dispose(); }
  });
}

for (const backend of ['source', 'cil']) {
  test(`A23 T39 ${backend} accepts only the compiler startup's implicit string-array bootstrap`, async () => {
    const compiled = compileToIL(`class Entry {
      static int count;
      static void Main(string[] args) { count = args.Length; }
      public static int Read() { return count; }
    }`);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const artifact = backend === 'cil' ? compiled.assembly : compiled.image;
    const session = new ManagedInvocationSession(artifact, {backend, programArguments: ['one', 'two']});
    try {
      assert.equal((await session.invoke('Entry.Read')).value, 2);
      assert.equal((await session.invoke('Entry.Read')).value, 2);
    } finally { session.dispose(); }
    if (backend === 'source') {
      assert.throws(() => new ManagedInvocationSession(artifact, {backend, entryPoint: 'Entry.Main'}), /parameterless/);
    }
  });
}
