import test from 'node:test';
import assert from 'node:assert/strict';
import { linesOf, runOnBothBackEnds, notExecutable } from './support/semantic-codegen.js';

const program = body => `using System;\nusing System.Collections.Generic;\nclass Program {\n${body}\n}\n`;

test('SF-A02-T09.1 an iterator runs lazily: nothing executes before the first MoveNext', () => {
  const lines = linesOf(
    program(`
      static IEnumerable<int> Numbers() { Console.WriteLine("begin"); yield return 1; Console.WriteLine("middle"); yield return 2; Console.WriteLine("end"); }
      static void Main() {
        var numbers = Numbers();
        Console.WriteLine("created");
        foreach (int n in numbers) Console.WriteLine(n);
      }`),
  );
  assert.deepEqual(lines, ['created', 'begin', '1', 'middle', '2', 'end']);
});

test('SF-A02-T09.1 locals, parameters and loop state survive each yield', () => {
  const lines = linesOf(
    program(`
      static IEnumerable<int> Fibonacci(int count) {
        int a = 0, b = 1;
        for (int i = 0; i < count; i++) { yield return a; int next = a + b; a = b; b = next; }
      }
      static IEnumerable<string> Pairs(string[] names, int[] ages) {
        int index = 0;
        foreach (string name in names) { if (ages[index] < 0) { index++; continue; } yield return name + ages[index]; index++; }
      }
      static void Main() {
        string text = "";
        foreach (int f in Fibonacci(8)) text += f + " ";
        Console.WriteLine(text);
        string[] names = { "a", "b", "c" };
        int[] ages = { 1, -1, 3 };
        foreach (string p in Pairs(names, ages)) Console.WriteLine(p);
      }`),
  );
  assert.deepEqual(lines, ['0 1 1 2 3 5 8 13 ', 'a1', 'c3']);
});

test('SF-A02-T09.1 every enumeration of an IEnumerable starts from the arguments of the call', () => {
  const lines = linesOf(
    program(`
      static IEnumerable<int> Down(int from) { while (from > 0) { yield return from; from--; } }
      static void Main() {
        var down = Down(2);
        foreach (int a in down) foreach (int b in down) Console.WriteLine(a * 10 + b);
      }`),
  );
  assert.deepEqual(lines, ['22', '21', '12', '11']);
});

test('SF-A02-T09.1 yield break ends the sequence and MoveNext stays false afterwards', () => {
  const lines = linesOf(
    program(`
      static IEnumerator<int> Some(bool stop) { yield return 1; if (stop) yield break; yield return 2; }
      static void Main() {
        var e = Some(true);
        Console.WriteLine(e.MoveNext() + " " + e.Current);
        Console.WriteLine(e.MoveNext());
        Console.WriteLine(e.MoveNext());
        var all = Some(false);
        int count = 0;
        while (all.MoveNext()) count += all.Current;
        Console.WriteLine(count);
        var disposed = Some(false);
        disposed.MoveNext();
        disposed.Dispose();
        Console.WriteLine(disposed.MoveNext());
      }`),
  );
  assert.deepEqual(lines, ['True 1', 'False', 'False', '3', 'False']);
});

test('SF-A02-T09.1 instance iterators read their object; iterators over one element type share an image class', () => {
  const { output, image } = runOnBothBackEnds(`
    using System;
    using System.Collections.Generic;
    class Bag {
      int[] items = { 4, 5 };
      public int Bonus = 1;
      public IEnumerable<int> Items() { foreach (int item in items) yield return item + Bonus; }
      public static IEnumerable<int> Twice(int value) { yield return value; yield return value; }
    }
    class Program {
      static void Main() {
        var bag = new Bag();
        var items = bag.Items();
        bag.Bonus = 10;
        foreach (int i in items) Console.WriteLine(i);
        foreach (int t in Bag.Twice(7)) Console.WriteLine(t);
      }
    }`);
  assert.deepEqual(output.trimEnd().split('\n'), ['14', '15', '7', '7']);
  const iteratorClasses = image.types.filter(t => t.name.startsWith('<>Iterator('));
  assert.deepEqual(
    iteratorClasses.map(t => t.name),
    ['<>Iterator(int)'],
  );
  assert.ok(image.methods.some(m => /^<Items>d__\d+\.MoveNext$/.test(m.name)), 'the state machine has a Roslyn-style name');
  assert.ok(iteratorClasses[0].fields.some(f => f.name.endsWith('<>4__this')), 'the receiver is hoisted');
});

test('SF-A02-T09.1 conversions of collections to IEnumerable<T> are reported', () => {
  const conversion = notExecutable(
    program(`
      static int Sum(IEnumerable<int> values) { int s = 0; foreach (int v in values) s += v; return s; }
      static IEnumerable<int> One() { yield return 1; }
      static void Main() { int[] array = { 1, 2 }; Console.WriteLine(Sum(array) + Sum(One())); }`),
  );
  assert.match(conversion.message, /converting 'int\[\]' to/);
});
