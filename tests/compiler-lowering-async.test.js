import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { notExecutable } from './support/semantic-codegen.js';
import { runAsyncOnBothBackEnds } from './support/async-codegen.js';

// Every program declares a delegate type, which puts it outside the string-typed profile: the image comes from the
// bound-tree lowering.
const program = body => `using System;\nusing System.Threading.Tasks;\ndelegate int Op(int x);\nclass Program {\n${body}\n}\n`;

function errorCodes(source) {
  return compile(source)
    .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
    .sort((a, b) => a.start - b.start)
    .map(d => d.code);
}

test('SF-A02-T09.2 an async method runs up to its first pending await, then completes its task', () => {
  const { lines, image } = runAsyncOnBothBackEnds(
    program(`
      static async Task<int> Work(int v) { Console.WriteLine("start"); await Task.Delay(1); Console.WriteLine("end"); return v * 2; }
      static async Task Main() {
        Task<int> task = Work(21);
        Console.WriteLine("returned " + task.IsCompleted);
        Console.WriteLine(await task);
      }`),
  );
  assert.deepEqual(lines, ['start', 'returned False', 'end', '42']);
  const work = image.methods.filter(m => m.asyncOrigin === 'Program.Work');
  assert.deepEqual(work.map(m => m.asyncRole).sort(), ['body', 'capture', 'kickoff']);
  const body = work.find(m => m.asyncRole === 'body');
  assert.match(body.name, /^<Work>d__\d+\.MoveNext$/);
  assert.equal(body.returnType, 'int');
  assert.ok(body.sourceRange, 'the body carries the source range of the method');
});

test('SF-A02-T09.2 Task, Task<T>, ValueTask, ValueTask<T> and async void', () => {
  const { lines } = runAsyncOnBothBackEnds(
    program(`
      static async Task Plain() { await Task.Yield(); Console.WriteLine("plain"); }
      static async Task<string> Text() { await Task.Yield(); return "text"; }
      static async ValueTask Value() { await Task.Yield(); Console.WriteLine("value"); }
      static async ValueTask<int> Number() { await Task.Yield(); return 7; }
      static async void Fire() { await Task.Yield(); Console.WriteLine("fired"); }
      static async Task Main() {
        await Plain();
        Console.WriteLine(await Text());
        await Value();
        Console.WriteLine(await Number());
        Fire();
        Console.WriteLine("after fire");
        await Task.Delay(1);
      }`),
  );
  assert.deepEqual(lines, ['plain', 'text', 'value', '7', 'after fire', 'fired']);
});

test('SF-A02-T09.3 operands evaluated before an await keep their values and their order', () => {
  const { lines } = runAsyncOnBothBackEnds(
    program(`
      static int[] cells = new int[2];
      static int Trace(int v) { Console.WriteLine("eval " + v); return v; }
      static async Task<int> Slow(int v) { await Task.Delay(1); return v; }
      static int Sum(int a, int b, int c) { return a + b + c; }
      static async Task Main() {
        Console.WriteLine(Sum(Trace(1), await Slow(Trace(2)), Trace(3)));
        cells[Trace(1)] += await Slow(10) + Trace(4);
        Console.WriteLine(cells[1]);
      }`),
  );
  assert.deepEqual(lines, ['eval 1', 'eval 2', 'eval 3', '6', 'eval 1', 'eval 4', '14']);
});

test('SF-A02-T09.2 await inside try, catch and finally; a fault leaves through the awaiting caller', () => {
  const { lines } = runAsyncOnBothBackEnds(
    program(`
      static async Task<int> Guarded(bool fail) {
        try { await Task.Delay(1); if (fail) throw new Exception("failed"); return 1; }
        catch (Exception e) { await Task.Yield(); Console.WriteLine("catch " + e.Message); throw; }
        finally { await Task.Yield(); Console.WriteLine("finally"); }
      }
      static async Task Main() {
        Console.WriteLine(await Guarded(false));
        try { await Guarded(true); } catch (Exception e) { Console.WriteLine("outer " + e.Message); }
      }`),
  );
  assert.deepEqual(lines, ['finally', '1', 'catch failed', 'finally', 'outer failed']);
});

test('SF-A02-T09.2 async lambdas and local functions capture variables and the receiver', () => {
  const { lines } = runAsyncOnBothBackEnds(`
    using System;
    using System.Threading.Tasks;
    class Program {
      int seed = 3;
      async Task<int> Run() {
        int captured = 5;
        Func<Task> bump = async () => { await Task.Yield(); captured += seed; };
        await bump();
        async Task<int> Local(int k) { await Task.Delay(1); return k + captured; }
        Func<int, Task<int>> square = async v => { await Task.Yield(); return v * v; };
        return await Local(10) + await square(2);
      }
      static async Task Main() { Console.WriteLine(await new Program().Run()); }
    }`);
  assert.deepEqual(lines, ['22']);
});

test('SF-A02-T09.2 top-level statements with await run as an async entry point', () => {
  const { lines } = runAsyncOnBothBackEnds(`
    using System;
    using System.Threading.Tasks;
    Func<int, int> twice = x => x * 2;
    Console.WriteLine(twice(await Value(4)));
    static async Task<int> Value(int v) { await Task.Delay(1); return v + 1; }
  `);
  assert.deepEqual(lines, ['10']);
});

test('SF-A02-T09.2 a task without a registered numeric construction is named', () => {
  const longResult = notExecutable(
    program(`
      static async Task<long> Make() { await Task.Yield(); return 1; }
      static async Task Main() { await Make(); }`),
  );
  assert.match(longResult.message, /framework registry has no.*Task<long>/);
});

test('SF-A02-T02.6 a task of a user class shares the runtime task over object', () => {
  // This program was "not executable: Task<Program>" before generic lowering; the registry lists Task<object>.
  const { lines } = runAsyncOnBothBackEnds(
    program(`
      public string Name = "made";
      static async Task<Program> Make() { await Task.Yield(); return new Program(); }
      static async Task Main() { Console.WriteLine((await Make()).Name); }`),
  );
  assert.deepEqual(lines, ['made']);
});

test('SF-A02-T09.2 async diagnostics: parameters, lock, return and await placement', () => {
  const method = text => program(`${text}\n static void Main() { }`);
  assert.deepEqual(errorCodes(method('static async Task M(ref int a) { await Task.Delay(1); }')), ['CS1988']);
  assert.deepEqual(errorCodes(method('static async Task M(object o) { lock (o) { await Task.Delay(1); } }')), ['CS1996']);
  assert.deepEqual(errorCodes(method('static async Task M() { await Task.Delay(1); return 1; }')), ['CS1997']);
  assert.deepEqual(errorCodes(method('static async Task<int> M() { await Task.Delay(1); }')), ['CS0161']);
  assert.deepEqual(errorCodes(method('static Task M() { await Task.Delay(1); return null; }')), ['CS4032']);
  assert.deepEqual(errorCodes(method('static void M() { await Task.Delay(1); }')), ['CS4033']);
  assert.deepEqual(errorCodes(method('static void M() { Func<int> f = () => { await Task.Delay(1); return 1; }; }')), ['CS4034']);
  assert.deepEqual(errorCodes(method('static async Task M() { await 5; }')), ['CS1061']);
  assert.deepEqual(errorCodes(method('static async int M() { await Task.Delay(1); return 1; }')), ['CS1983']);
});
