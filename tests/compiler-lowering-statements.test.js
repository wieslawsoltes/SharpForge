import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

// Every program declares a delegate so that it is outside the string-typed profile and goes through the semantic generator.
const program = body => `using System;\nusing System.Collections.Generic;\ndelegate void Marker();\nclass Program {\n${body}\n}\n`;

test('SF-A02-T09.6 foreach over arrays, framework collections and the GetEnumerator pattern', () => {
  const lines = linesOf(`
    using System;
    using System.Collections.Generic;
    delegate void Marker();
    class Countdown {
      int from;
      public Countdown(int from) { this.from = from; }
      public Cursor GetEnumerator() { return new Cursor(from); }
    }
    class Cursor {
      int next;
      public static int Disposed;
      public Cursor(int start) { next = start + 1; }
      public int Current { get { return next; } }
      public bool MoveNext() { next--; return next > 0; }
      public void Dispose() { Disposed++; }
    }
    class Program {
      static void Main() {
        int[] numbers = { 1, 2, 3 };
        int sum = 0;
        foreach (int n in numbers) sum += n;
        var list = new List<string>();
        list.Add("a"); list.Add("b");
        string joined = "";
        foreach (string s in list) joined += s;
        foreach (int n in new Countdown(3)) { if (n == 1) break; joined += n; }
        Console.WriteLine(sum + joined + Cursor.Disposed);
        double total = 0;
        foreach (double d in numbers) total += d / 2;
        Console.WriteLine(total);
      }
    }`);
  // Cursor has a Dispose method but is not IDisposable: foreach does not call it (.NET prints the same).
  assert.deepEqual(lines, ['6ab320', '3']);
});

test('using statements dispose in reverse order, also when the body throws', () => {
  const lines = linesOf(`
    using System;
    delegate void Marker();
    class Resource : IDisposable {
      string name;
      public static string Log = "";
      public Resource(string name) { this.name = name; Log += "+" + name; }
      public void Dispose() { Log += "-" + name; }
    }
    class Program {
      static void Main() {
        using (Resource a = new Resource("a"), b = new Resource("b")) { Resource.Log += "!"; }
        try { using (var c = new Resource("c")) { throw new Exception("boom"); } }
        catch (Exception e) { Resource.Log += e.Message; }
        Console.WriteLine(Resource.Log);
      }
    }`);
  assert.deepEqual(lines, ['+a+b!-b-a+c-cboom']);
});

test('loops, conditional operators, compound assignment and string switches', () => {
  const lines = linesOf(
    program(`
      static string Kind(string s) { switch (s) { case "a": case "b": return "early"; case "z": return "late"; default: return "middle"; } }
      static void Main() {
        int i = 0, evens = 0;
        while (true) { i++; if (i > 10) break; if (i % 2 == 1) continue; evens += i; }
        do { i -= 3; } while (i > 0);
        string text = null;
        text ??= "set";
        text += i;
        int[] data = new int[3];
        for (int a = 0, b = 2; a < 3; a++, b--) data[a] = b * 10;
        data[1] += 5; data[2]++;
        Console.WriteLine(evens + " " + text + " " + data[0] + data[1] + data[2]);
        Console.WriteLine(Kind("a") + Kind("z") + Kind("m"));
        double ratio = (double)7 / 2;
        int truncated = (int)ratio;
        Console.WriteLine(ratio + " " + truncated + " " + (truncated > 2 ? "big" : "small"));
      }`),
  );
  assert.deepEqual(lines, ['30 set-1 20151', 'earlylatemiddle', '3.5 3 big']);
});

test('try, catch and finally run in order; a rethrow keeps the exception', () => {
  const lines = linesOf(
    program(`
      static string log = "";
      static int Risky(int n) {
        try { if (n == 0) throw new Exception("zero"); log += "ok"; return n; }
        catch (Exception e) { log += e.Message; throw; }
        finally { log += ";"; }
      }
      static void Main() {
        Risky(1);
        try { Risky(0); } catch { log += "caught"; }
        Console.WriteLine(log);
      }`),
  );
  assert.deepEqual(lines, ['ok;zero;caught']);
});

test('constructs that need runtime support are reported with their name and position', () => {
  const cases = [
    ['class B { } class D : B { } class P { static void Main() { } }', /class inheritance/],
    ['struct S { } class P { static void Main() { S s = new S(); } }', /struct types/],
    ['delegate void D(ref int x); class P { static void M(ref int x) { x = 1; } static void Main() { D d = M; int v = 0; d(ref v); } }', /ref, out and in parameters/],
    ['using System; class P { static void Main() { try { } catch (InvalidOperationException) { } } }', /./],
    ['class B<T> { } class P { static int D<T>(T x, int n) { return D(new B<T>(), n); } static void Main() { D(1, 2); } }', /does not terminate/],
    ['class P { static void Main() { object o = "s"; string s = (string)o; System.Console.WriteLine(s); } }', /runtime type check/],
  ];
  for (const [source, expected] of cases) {
    const result = compile(source);
    assert.equal(result.image, null, source);
    assert.equal(result.success, false, source);
    const reported = result.diagnostics.filter(d => d.code === 'SF2200');
    if (reported.length) assert.match(reported[0].message, expected, source);
    else assert.ok(result.diagnostics.some(d => d.severity === 'error'), source);
  }
  const reported = notExecutable('class B { } class Derived : B { } class P { static void Main() { } }');
  assert.equal(reported.start, 'class B { } class '.length, 'the diagnostic points at the construct');
});

test('a program inside the execution profile is still compiled by the profile pipeline', () => {
  const result = compile('class C { public int N; } class P { static void Main() { var c = new C(); c.N = 1; System.Console.WriteLine(c.N); } }');
  assert.equal(result.success, true);
  assert.equal(result.semantic, undefined, 'the semantic generator is not involved');
});

test('SF-A02-T43 goto and labels are jumps', () => {
  const lines = linesOf(
    program(`
      static void Main() {
        int i = 0;
        string log = "";
        again:
        i++;
        if (i == 2) goto skip;
        log += i;
        skip:
        if (i < 4) goto again;
        for (int a = 0; a < 3; a++) { for (int b = 0; b < 3; b++) { if (a * b == 2) goto done; log += "."; } }
        done:
        Console.WriteLine(log);
      }`),
  );
  assert.deepEqual(lines, ['134.....']);
  // goto case used to be reported as SF2200; it is lowered now (tests/compiler-jumps.test.js).
  assert.deepEqual(linesOf(program(`static void Main() { int n = 1; switch (n) { case 1: goto case 2; case 2: Console.WriteLine(n); break; } }`)), ['1']);
});
