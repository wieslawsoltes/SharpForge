import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf, runOnBothBackEnds } from './support/semantic-codegen.js';

const program = body => `using System;\nusing System.Collections;\nusing System.Collections.Generic;\nclass Program {\n${body}\n}\n`;

/** The C# error codes a program gets, in source order. */
function errorCodes(source) {
  return compile(source)
    .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
    .sort((a, b) => a.start - b.start)
    .map(d => d.code);
}

test('SF-A02-T09.1 a finally block around yield runs when the try block is left, not when the iterator suspends', () => {
  const lines = linesOf(
    program(`
      static IEnumerable<int> Guarded() {
        try { Console.WriteLine("enter"); yield return 1; Console.WriteLine("between"); yield return 2; }
        finally { Console.WriteLine("finally"); }
        yield return 3;
      }
      static void Main() { foreach (int g in Guarded()) Console.WriteLine(g); }`),
  );
  assert.deepEqual(lines, ['enter', '1', 'between', '2', 'finally', '3']);
});

test('SF-A02-T09.1 leaving a foreach early disposes the iterator: nested finally blocks run innermost first', () => {
  const lines = linesOf(
    program(`
      static IEnumerable<int> Nested() {
        try {
          yield return 1;
          try { yield return 2; yield return 3; }
          finally { Console.WriteLine("inner"); }
        }
        finally { Console.WriteLine("outer"); }
      }
      static void Main() {
        foreach (int x in Nested()) { Console.WriteLine(x); if (x == 2) break; }
        foreach (int x in Nested()) { Console.WriteLine(x); break; }
      }`),
  );
  assert.deepEqual(lines, ['1', '2', 'inner', 'outer', '1', 'outer']);
});

test('SF-A02-T09.1 Dispose finishes the machine in every state and runs pending finally blocks once', () => {
  const lines = linesOf(
    program(`
      static IEnumerator<int> Guarded() {
        try { yield return 1; yield return 2; } finally { Console.WriteLine("finally"); }
        yield return 3;
      }
      static void Main() {
        var fresh = Guarded();
        fresh.Dispose();
        Console.WriteLine(fresh.MoveNext());
        var inside = Guarded();
        inside.MoveNext();
        inside.Dispose();
        inside.Dispose();
        Console.WriteLine(inside.MoveNext() + " " + inside.Current);
        var past = Guarded();
        past.MoveNext(); past.MoveNext(); past.MoveNext();
        past.Dispose();
        Console.WriteLine(past.MoveNext() + " " + past.Current);
      }`),
  );
  assert.deepEqual(lines, ['False', 'finally', 'False 1', 'finally', 'False 3']);
});

test('SF-A02-T09.1 yield break, break, continue, goto and exceptions leave a protected region through its finally', () => {
  const lines = linesOf(
    program(`
      static IEnumerable<int> Loop() {
        for (int i = 0; i < 5; i++) {
          try {
            if (i == 1) continue;
            if (i == 3) break;
            yield return i;
          }
          finally { Console.WriteLine("f" + i); }
        }
        try { yield return 10; yield break; } finally { Console.WriteLine("last"); }
      }
      static IEnumerable<int> Throws() {
        try { yield return 1; throw new Exception("boom"); } finally { Console.WriteLine("unwound"); }
      }
      static void Main() {
        foreach (int x in Loop()) Console.WriteLine(x);
        var e = Throws().GetEnumerator();
        e.MoveNext();
        try { e.MoveNext(); } catch (Exception error) { Console.WriteLine(error.Message); }
        Console.WriteLine(e.MoveNext());
      }`),
  );
  assert.deepEqual(lines, ['0', 'f0', 'f1', '2', 'f2', 'f3', '10', 'last', 'unwound', 'boom', 'False']);
});

test('SF-A02-T09.1 using and a disposing foreach inside an iterator release their resource on early exit', () => {
  const { output, image } = runOnBothBackEnds(`
    using System;
    using System.Collections.Generic;
    class Resource : IDisposable {
      string name;
      public Resource(string name) { this.name = name; }
      public void Dispose() { Console.WriteLine("close " + name); }
    }
    class Program {
      static IEnumerable<int> Inner() { try { yield return 1; yield return 2; } finally { Console.WriteLine("inner done"); } }
      static IEnumerable<int> Outer() {
        using (var r = new Resource("r"))
          foreach (int x in Inner()) yield return x * 10;
      }
      static void Main() {
        foreach (int x in Outer()) { Console.WriteLine(x); break; }
      }
    }`);
  assert.deepEqual(output.trimEnd().split('\n'), ['10', 'inner done', 'close r']);
  assert.ok(image.methods.some(m => m.qualifiedName === '<>Iterator(int).Dispose'), 'the iterator class has a Dispose dispatcher');
});

test('SF-A02-T09.1 IEnumerable and IEnumerator iterators enumerate objects', () => {
  const lines = linesOf(
    program(`
      static IEnumerable Words() { yield return "a"; yield return "b"; }
      static IEnumerator Count(int n) { while (n > 0) { yield return "n" + n; n--; } }
      static void Main() {
        foreach (object word in Words()) Console.WriteLine(word);
        IEnumerator e = Count(2);
        while (e.MoveNext()) Console.WriteLine(e.Current);
      }`),
  );
  assert.deepEqual(lines, ['a', 'b', 'n2', 'n1']);
});

test('SF-A02-T09.1 iterator block errors: placement of yield, return type and parameters', () => {
  const body = statements => program(`static IEnumerable<int> M() { ${statements} }\n static void Main() { }`);
  assert.deepEqual(errorCodes(body('try { yield return 1; } catch { }')), ['CS1626']);
  assert.deepEqual(errorCodes(body('try { } catch { yield return 1; }')), ['CS1631']);
  assert.deepEqual(errorCodes(body('try { } finally { yield return 1; }')), ['CS1625']);
  assert.deepEqual(errorCodes(body('try { } finally { yield break; }')), ['CS1625']);
  assert.deepEqual(errorCodes(body('try { yield break; } catch { yield break; }')), []);
  assert.deepEqual(errorCodes(body('Action a = () => { yield break; }; yield return 1;')), ['CS1621']);
  assert.deepEqual(errorCodes(body('yield return 1; return null;')), ['CS1622']);
  assert.deepEqual(errorCodes(program('static int M() { yield return 1; }\n static void Main() { }')), ['CS1624']);
  assert.deepEqual(errorCodes(program('static IEnumerable<int> M(ref int a, out int b) { b = 0; yield return a; }\n static void Main() { }')), [
    'CS1623',
    'CS1623',
  ]);
});
