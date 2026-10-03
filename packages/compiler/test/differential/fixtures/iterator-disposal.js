/**
 * Differential fixtures for SF-A02-T09.1: iterators whose `yield return` sits inside `try`/`finally`, `using` or a
 * disposing `foreach`, their disposal, the non-generic iterator interfaces, and the iterator block diagnostics.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('iterator-disposal', [
    out(
      'nested-finally-and-early-break',
      cs`
    using System;
    using System.Collections.Generic;
    class Program
    {
        static IEnumerable<int> Nested(int limit)
        {
            Console.WriteLine("start");
            try
            {
                yield return 1;
                try
                {
                    for (int i = 2; i < limit; i++)
                    {
                        if (i == 5) break;
                        yield return i;
                    }
                    yield return 100;
                }
                finally { Console.WriteLine("inner finally"); }
                yield return 200;
            }
            finally { Console.WriteLine("outer finally"); }
            Console.WriteLine("end");
        }
        static void Main()
        {
            foreach (int x in Nested(10)) Console.WriteLine(x);
            Console.WriteLine("--- break inside the inner try");
            foreach (int x in Nested(10)) { Console.WriteLine(x); if (x == 3) break; }
            Console.WriteLine("--- break inside the outer try only");
            foreach (int x in Nested(10)) { Console.WriteLine(x); break; }
        }
    }
  `,
    ),
    out(
      'using-inside-iterator',
      cs`
    using System;
    using System.Collections.Generic;
    class Resource : IDisposable
    {
        string name;
        public Resource(string name) { this.name = name; Console.WriteLine("open " + name); }
        public void Dispose() { Console.WriteLine("close " + name); }
    }
    class Program
    {
        static IEnumerable<string> WithUsing()
        {
            using (var a = new Resource("a"))
            using (var b = new Resource("b"))
            {
                yield return "first";
                yield return "second";
            }
            yield return "after";
        }
        static void Main()
        {
            foreach (string s in WithUsing()) Console.WriteLine(s);
            foreach (string s in WithUsing()) { Console.WriteLine(s); break; }
        }
    }
  `,
    ),
    out(
      'yield-break-and-exception-run-finally',
      cs`
    using System;
    using System.Collections.Generic;
    class Program
    {
        static IEnumerable<int> Breaks(bool stop)
        {
            try
            {
                yield return 1;
                if (stop) yield break;
                yield return 2;
            }
            finally { Console.WriteLine("cleanup"); }
        }
        static IEnumerable<int> Throws()
        {
            try
            {
                yield return 1;
                throw new Exception("boom");
            }
            finally { Console.WriteLine("finally after throw"); }
        }
        static IEnumerable<int> FinallyThrows()
        {
            try
            {
                try { yield return 1; }
                finally { Console.WriteLine("inner"); throw new Exception("from finally"); }
            }
            finally { Console.WriteLine("outer"); }
        }
        static void Main()
        {
            foreach (int x in Breaks(true)) Console.WriteLine(x);
            foreach (int x in Breaks(false)) Console.WriteLine(x);
            try { foreach (int x in Throws()) Console.WriteLine(x); }
            catch (Exception e) { Console.WriteLine("caught " + e.Message); }
            try { foreach (int x in FinallyThrows()) { Console.WriteLine(x); break; } }
            catch (Exception e) { Console.WriteLine("caught " + e.Message); }
        }
    }
  `,
    ),
    out(
      'manual-dispose-states',
      cs`
    using System;
    using System.Collections.Generic;
    class Program
    {
        static IEnumerator<int> Plain() { yield return 1; yield return 2; yield return 3; }
        static IEnumerator<int> Guarded()
        {
            try { yield return 1; yield return 2; }
            finally { Console.WriteLine("finally"); }
            yield return 3;
        }
        static void Main()
        {
            var suspended = Plain();
            suspended.MoveNext();
            suspended.Dispose();
            Console.WriteLine(suspended.MoveNext() + " " + suspended.Current);
            var fresh = Plain();
            fresh.Dispose();
            Console.WriteLine(fresh.MoveNext() + " " + fresh.Current);
            var inside = Guarded();
            inside.MoveNext();
            inside.Dispose();
            Console.WriteLine(inside.MoveNext() + " " + inside.Current);
            inside.Dispose();
            var past = Guarded();
            past.MoveNext(); past.MoveNext(); past.MoveNext();
            past.Dispose();
            Console.WriteLine(past.MoveNext() + " " + past.Current);
            using (IEnumerator<int> scoped = Guarded())
            {
                scoped.MoveNext();
                Console.WriteLine("scoped " + scoped.Current);
            }
            Console.WriteLine("done");
        }
    }
  `,
    ),
    out(
      'jumps-out-of-a-protected-region',
      cs`
    using System;
    using System.Collections.Generic;
    class Program
    {
        static IEnumerable<int> Jumps()
        {
            int i = 0;
            again:
            try
            {
                i++;
                yield return i;
                if (i < 3) goto again;
                yield return 99;
            }
            finally { Console.WriteLine("leave " + i); }
        }
        static IEnumerable<int> Loop()
        {
            for (int i = 0; i < 4; i++)
            {
                try
                {
                    if (i == 1) continue;
                    if (i == 3) break;
                    yield return i;
                }
                finally { Console.WriteLine("iteration " + i); }
            }
        }
        static IEnumerable<string> Sections(int[] values)
        {
            foreach (int value in values)
            {
                try
                {
                    switch (value)
                    {
                        case 1: yield return "one"; break;
                        case 2: yield return "two"; yield return "two again"; break;
                        default: yield return "many"; break;
                    }
                }
                finally { Console.WriteLine("after " + value); }
            }
        }
        static void Main()
        {
            foreach (int j in Jumps()) Console.WriteLine(j);
            foreach (int j in Loop()) Console.WriteLine(j);
            int[] values = { 1, 2, 7 };
            foreach (string s in Sections(values)) Console.WriteLine(s);
            foreach (string s in Sections(values)) { if (s == "two") break; }
        }
    }
  `,
    ),
    out(
      'iterators-over-iterators-dispose-inner',
      cs`
    using System;
    using System.Collections.Generic;
    class Counter
    {
        int step;
        public Counter(int step) { this.step = step; }
        public IEnumerable<int> Up(int count)
        {
            int value = 0;
            try
            {
                for (int i = 0; i < count; i++) { value += step; yield return value; }
            }
            finally { Console.WriteLine("counter done at " + value); }
        }
        public IEnumerator<string> GetEnumerator()
        {
            yield return "a" + step;
            yield return "b" + step;
        }
    }
    class Program
    {
        static IEnumerable<int> Scaled(Counter counter)
        {
            foreach (int x in counter.Up(4))
            {
                yield return x * 10;
            }
            Console.WriteLine("scaled done");
        }
        static void Main()
        {
            var counter = new Counter(5);
            foreach (int v in counter.Up(3)) Console.WriteLine(v);
            foreach (string s in counter) Console.WriteLine(s);
            foreach (int v in Scaled(counter)) { Console.WriteLine(v); if (v == 100) break; }
            foreach (int v in Scaled(counter)) Console.WriteLine(v);
        }
    }
  `,
    ),
    out(
      'non-generic-iterator-interfaces',
      cs`
    using System;
    using System.Collections;
    class Program
    {
        static IEnumerable Plain()
        {
            yield return "text";
            yield return "more";
        }
        static IEnumerator Countdown(int n)
        {
            while (n > 0) { yield return "n" + n; n--; }
        }
        static void Main()
        {
            foreach (object o in Plain()) Console.WriteLine(o);
            IEnumerator e = Countdown(2);
            while (e.MoveNext()) Console.WriteLine(e.Current);
            Console.WriteLine(e.MoveNext());
        }
    }
  `,
    ),
    diag(
      'cs1626-yield-in-try-with-catch',
      cs`
    using System.Collections.Generic;
    class Program
    {
        static IEnumerable<int> Values()
        {
            try { yield return 1; } catch { }
            try { yield break; } catch { yield break; }
        }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs1631-yield-in-catch',
      cs`
    using System.Collections.Generic;
    class Program
    {
        static IEnumerable<int> Values()
        {
            try { } catch { yield return 2; }
        }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs1625-yield-in-finally',
      cs`
    using System.Collections.Generic;
    class Program
    {
        static IEnumerable<int> Values()
        {
            try { } finally { yield return 3; }
            try { } finally { yield break; }
        }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs1624-not-an-iterator-interface',
      cs`
    using System.Collections.Generic;
    class Program
    {
        static int Number() { yield return 1; }
        static List<int> Listed() { yield return 1; }
        int Property { get { yield break; } }
        static void Main() { yield return 5; }
    }
  `,
    ),
    diag(
      'cs1623-by-reference-parameters',
      cs`
    using System.Collections.Generic;
    class Program
    {
        static IEnumerable<int> Values(ref int a, out int b, in int c, int d) { b = 0; yield return a + c + d; }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs1621-yield-in-lambda',
      cs`
    using System;
    using System.Collections.Generic;
    class Program
    {
        static IEnumerable<int> Values()
        {
            Action act = () => { yield break; };
            Func<int> make = delegate { yield return 1; };
            yield return 1;
        }
        static void Main() { }
    }
  `,
    ),
    diag(
      'cs1622-return-in-iterator',
      cs`
    using System.Collections.Generic;
    class Program
    {
        static IEnumerable<int> Values() { yield return 1; return null; }
        static void Main() { }
    }
  `,
    ),
  ]),
];
