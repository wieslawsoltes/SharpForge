import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf } from './support/semantic-codegen.js';

const range = `
  class Range { public int To; public Range(int to) { To = to; } }
  class RangeEnumerator {
    int current, to;
    public RangeEnumerator(int to) { this.to = to; }
    public int Current { get { return current; } }
    public bool MoveNext() { current++; return current <= to; }
  }
  static class Extensions {
    public static RangeEnumerator GetEnumerator(this Range range) { return new RangeEnumerator(range.To); }
  }`;

test('SF-A02-T09.6 foreach finds GetEnumerator as an extension method', () => {
  const lines = linesOf(`using System;${range}
    class Program { static void Main() { int sum = 0; foreach (int i in new Range(4)) sum += i; Console.WriteLine(sum); } }`);
  assert.deepEqual(lines, ['10']);
});

test('SF-A02-T09.6 an extension GetEnumerator needs C# 9', () => {
  const source = `${range}\n class Program { static void Main() { foreach (int i in new Range(4)) { } } }`;
  const gate = compile(source, { langVersion: '8' }).diagnostics.filter(d => d.code === 'CS8400');
  assert.equal(gate.length, 1);
  assert.match(gate[0].message, /extension GetEnumerator/);
  assert.deepEqual(
    compile(source, { langVersion: '9' }).diagnostics.filter(d => d.severity === 'error'),
    [],
  );
});

test('SF-A02-T09.6 a pattern enumerator is disposed only when it is IDisposable', () => {
  const lines = linesOf(`using System;
    delegate void Marker();
    class Plain { public PlainCursor GetEnumerator() { return new PlainCursor(); } }
    class PlainCursor {
      int value;
      public int Current { get { return value; } }
      public bool MoveNext() { value++; return value <= 1; }
      public void Dispose() { Console.WriteLine("not called"); }
    }
    class Closing { public ClosingCursor GetEnumerator() { return new ClosingCursor(); } }
    class ClosingCursor : IDisposable {
      int value;
      public int Current { get { return value; } }
      public bool MoveNext() { value++; return value <= 1; }
      public void Dispose() { Console.WriteLine("disposed"); }
    }
    class Program {
      static void Main() {
        foreach (int p in new Plain()) Console.WriteLine(p);
        foreach (int c in new Closing()) Console.WriteLine(c);
      }
    }`);
  assert.deepEqual(lines, ['1', '1', 'disposed']);
});

test('SF-A02-T09.1 a local function can be an iterator and capture variables and the receiver', () => {
  const lines = linesOf(`using System;
    using System.Collections.Generic;
    class Program {
      int scale = 3;
      IEnumerable<int> Scaled(int count) {
        int offset = 100;
        IEnumerable<int> Inner(int from) {
          try { for (int i = from; i < from + count; i++) { offset++; yield return i * scale; } }
          finally { Console.WriteLine("inner done"); }
        }
        foreach (int x in Inner(1)) yield return x;
        yield return offset;
      }
      static void Main() { foreach (int x in new Program().Scaled(2)) Console.WriteLine(x); }
    }`);
  assert.deepEqual(lines, ['3', '6', 'inner done', '102']);
});
