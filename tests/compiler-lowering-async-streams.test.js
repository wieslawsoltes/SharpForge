import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { runAsyncOnBothBackEnds } from './support/async-codegen.js';

const usings = 'using System;\nusing System.Collections.Generic;\nusing System.Threading.Tasks;\n';
const program = body => `${usings}class Program {\n${body}\n}\n`;

function errorCodes(source) {
  return compile(source)
    .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
    .sort((a, b) => a.start - b.start)
    .map(d => d.code);
}

test('SF-A02-T09.4 an async iterator awaits between elements and await foreach consumes it', () => {
  const { lines, image } = runAsyncOnBothBackEnds(
    program(`
      static async IAsyncEnumerable<int> Numbers(int count) {
        for (int i = 1; i <= count; i++) { await Task.Delay(1); yield return i * 10; }
      }
      static async Task Main() {
        int sum = 0;
        await foreach (int n in Numbers(3)) { Console.WriteLine(n); sum += n; }
        Console.WriteLine(sum);
      }`),
  );
  assert.deepEqual(lines, ['10', '20', '30', '60']);
  assert.ok(image.methods.some(m => /^<Numbers>d__\d+\.MoveNext$/.test(m.name)), 'the stream is an iterator state machine');
});

test('SF-A02-T09.4 leaving await foreach early disposes the stream: its finally block runs, and may await', () => {
  const { lines } = runAsyncOnBothBackEnds(
    program(`
      static async IAsyncEnumerable<int> Guarded() {
        try { yield return 1; await Task.Delay(1); yield return 2; yield return 3; }
        finally { await Task.Yield(); Console.WriteLine("finally"); }
      }
      static async Task Main() {
        await foreach (int n in Guarded()) { Console.WriteLine(n); if (n == 2) break; }
        Console.WriteLine("after");
      }`),
  );
  assert.deepEqual(lines, ['1', '2', 'finally', 'after']);
});

test('SF-A02-T09.4 MoveNextAsync and DisposeAsync of an async enumerator are tasks', () => {
  const { lines } = runAsyncOnBothBackEnds(
    program(`
      static async IAsyncEnumerable<string> Words() { yield return "a"; await Task.Delay(1); yield return "b"; }
      static async Task Main() {
        IAsyncEnumerator<string> e = Words().GetAsyncEnumerator();
        ValueTask<bool> pending = e.MoveNextAsync();
        Console.WriteLine(await pending);
        Console.WriteLine(e.Current);
        while (await e.MoveNextAsync()) Console.WriteLine(e.Current);
        await e.DisposeAsync();
        Console.WriteLine(await e.MoveNextAsync());
      }`),
  );
  assert.deepEqual(lines, ['True', 'a', 'b', 'False']);
});

test('SF-A02-T09.4 await foreach over the GetAsyncEnumerator pattern awaits MoveNextAsync and DisposeAsync', () => {
  const { lines } = runAsyncOnBothBackEnds(`${usings}
    class Ticker { public TickerEnumerator GetAsyncEnumerator() { return new TickerEnumerator(); } }
    class TickerEnumerator {
      int value;
      public int Current { get { return value; } }
      public async ValueTask<bool> MoveNextAsync() { await Task.Delay(1); value++; return value <= 2; }
      public async ValueTask DisposeAsync() { await Task.Yield(); Console.WriteLine("disposed"); }
    }
    class Program {
      static async Task Main() { await foreach (int t in new Ticker()) Console.WriteLine(t); }
    }`);
  assert.deepEqual(lines, ['1', '2', 'disposed']);
});

test('SF-A02-T09.4 await using and using declarations dispose in reverse order when the scope is left', () => {
  const { lines } = runAsyncOnBothBackEnds(`${usings}
    class Res : IAsyncDisposable {
      string name;
      public Res(string name) { this.name = name; }
      public async ValueTask DisposeAsync() { await Task.Delay(1); Console.WriteLine("close " + name); }
    }
    class Plain : IDisposable {
      public void Dispose() { Console.WriteLine("plain"); }
    }
    class Program {
      static async Task Work(bool fail) {
        await using var first = new Res("first");
        await using (var second = new Res("second")) { Console.WriteLine("inside"); }
        using var plain = new Plain();
        if (fail) throw new Exception("failed");
        Console.WriteLine("end");
      }
      static async Task Main() {
        await Work(false);
        try { await Work(true); } catch (Exception e) { Console.WriteLine(e.Message); }
      }
    }`);
  assert.deepEqual(lines, ['inside', 'close second', 'end', 'plain', 'close first', 'inside', 'close second', 'plain', 'close first', 'failed']);
});

test('SF-A02-T09.4 async-stream diagnostics', () => {
  const stream = 'static async IAsyncEnumerable<int> Numbers() { await Task.Delay(1); yield return 1; }';
  const withStream = text => program(`${stream}\n${text}\n static void Main() { }`);
  assert.deepEqual(errorCodes(program('static IAsyncEnumerable<int> M() { yield return 1; }\n static void Main() { }')), ['CS8403']);
  assert.deepEqual(errorCodes(withStream('static async Task M() { foreach (int x in Numbers()) { } await Task.Delay(1); }')), ['CS8414']);
  assert.deepEqual(errorCodes(withStream('static async Task M(int[] a) { await foreach (int x in a) { } }')), ['CS8415']);
  assert.deepEqual(errorCodes(withStream('static async Task M() { await foreach (int x in 5) { } }')), ['CS8411']);
  assert.deepEqual(errorCodes(withStream('static void M() { await foreach (int x in Numbers()) { } }')), ['CS4033']);
  assert.deepEqual(errorCodes(withStream('static async Task M() { await using (var s = "text") { } }')), ['CS8410']);
});
