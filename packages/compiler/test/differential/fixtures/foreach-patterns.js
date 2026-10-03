/**
 * Differential fixtures for SF-A02-T09.6 and T09.1: `foreach` through an extension `GetEnumerator` (C# 9), disposal
 * of pattern enumerators, and iterator local functions.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('foreach-patterns', [
    out(
      'extension-get-enumerator',
      cs`
    using System;
    using System.Collections.Generic;
    class Range
    {
        public int From, To;
        public Range(int from, int to) { From = from; To = to; }
    }
    class RangeEnumerator
    {
        int current, to;
        public RangeEnumerator(int from, int to) { current = from - 1; this.to = to; }
        public int Current { get { return current; } }
        public bool MoveNext() { current++; return current <= to; }
        public void Dispose() { Console.WriteLine("never called: not IDisposable"); }
    }
    class Pair
    {
        public string First, Second;
        public Pair(string first, string second) { First = first; Second = second; }
    }
    static class Extensions
    {
        public static RangeEnumerator GetEnumerator(this Range range) { return new RangeEnumerator(range.From, range.To); }
        public static IEnumerator<string> GetEnumerator(this Pair pair)
        {
            try { yield return pair.First; yield return pair.Second; }
            finally { Console.WriteLine("pair done"); }
        }
    }
    class Program
    {
        static void Main()
        {
            foreach (int i in new Range(2, 4)) Console.WriteLine(i);
            foreach (var s in new Pair("a", "b")) { Console.WriteLine(s); break; }
            int sum = 0;
            foreach (var i in new Range(1, 3)) foreach (var j in new Range(i, 3)) sum += j;
            Console.WriteLine(sum);
        }
    }
  `,
    ),
    out(
      'only-idisposable-enumerators-are-disposed',
      cs`
    using System;
    class Counter
    {
        public Cursor GetEnumerator() { return new Cursor(); }
        public Closing Closing() { return new Closing(); }
    }
    class Cursor
    {
        int value;
        public int Current { get { return value; } }
        public bool MoveNext() { value++; return value <= 2; }
        public void Dispose() { Console.WriteLine("cursor: not IDisposable, not disposed"); }
    }
    class Closing
    {
        public ClosingCursor GetEnumerator() { return new ClosingCursor(); }
    }
    class ClosingCursor : IDisposable
    {
        int value;
        public int Current { get { return value; } }
        public bool MoveNext() { value++; return value <= 2; }
        public void Dispose() { Console.WriteLine("closing cursor disposed"); }
    }
    class Program
    {
        static void Main()
        {
            var counter = new Counter();
            foreach (int c in counter) Console.WriteLine(c);
            foreach (int c in counter.Closing()) Console.WriteLine(c);
            foreach (int c in counter.Closing()) break;
        }
    }
  `,
    ),
    out(
      'iterator-local-functions',
      cs`
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    class Program
    {
        int scale = 3;
        IEnumerable<int> Scaled(int count)
        {
            int offset = 100;
            IEnumerable<int> Inner(int from)
            {
                for (int i = from; i < from + count; i++)
                {
                    offset++;
                    yield return i * scale + Later(i);
                }
            }
            int Later(int v) { return v % 2; }
            foreach (int x in Inner(1)) yield return x;
            yield return offset;
        }
        static async Task Main()
        {
            IEnumerable<string> Words(string prefix)
            {
                try { yield return prefix + "a"; yield return prefix + "b"; }
                finally { Console.WriteLine("words done"); }
            }
            foreach (string w in Words("-")) Console.WriteLine(w);
            foreach (string w in Words("+")) { Console.WriteLine(w); break; }
            foreach (int x in new Program().Scaled(3)) Console.WriteLine(x);
            int total = 0;
            async IAsyncEnumerable<int> Ticks(int n)
            {
                for (int i = 0; i < n; i++) { await Task.Delay(1); total += i; yield return i; }
            }
            await foreach (int t in Ticks(3)) Console.WriteLine("tick " + t);
            Console.WriteLine(total);
        }
    }
  `,
    ),
    diag(
      'extension-get-enumerator-at-8',
      cs`
    class Range { }
    class RangeEnumerator
    {
        public int Current { get { return 0; } }
        public bool MoveNext() { return false; }
    }
    static class Extensions
    {
        public static RangeEnumerator GetEnumerator(this Range range) { return new RangeEnumerator(); }
    }
    class Program
    {
        static void Main()
        {
            foreach (int i in new Range()) { }
        }
    }
  `,
      { langVersion: '8' },
    ),
  ]),
];
