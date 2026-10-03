/**
 * Differential fixture for delegate equality: `==` and `!=` compare invocation lists (the methods and their targets,
 * in order), not object identity - for static and instance methods, for extension methods bound to a receiver, and
 * for combined delegates. Removal (`-=`) uses the same identity.
 */
import { cs, out, feature } from './kit.js';

export const fixtures = [
  ...feature('delegate-equality', [
    out(
      'invocation-lists-compare-by-method-and-target',
      cs`
        using System;
        class Counter { public int Count; public void Inc() { Count++; } public void Dec() { Count--; } }
        static class Extensions
        {
            public static void Bump(this Counter c) { c.Count++; }
            public static void Drop(this Counter c) { c.Count--; }
        }
        class Program
        {
            static void Hello() { }
            static void Main()
            {
                var counter = new Counter();
                var other = new Counter();
                Action a = counter.Bump;
                a += counter.Bump;
                a -= counter.Bump;
                a();
                Console.WriteLine(counter.Count);
                Action b = counter.Inc, c = counter.Inc, d = other.Inc, e = counter.Dec;
                Console.WriteLine((b == c) + " " + (b != c) + " " + (b == d) + " " + (b == e));
                Action x = counter.Bump, y = counter.Bump, z = other.Bump, w = counter.Drop;
                Console.WriteLine((x == y) + " " + (x == z) + " " + (x == w) + " " + (x == b));
                Action s1 = Hello, s2 = Hello, none = null;
                Console.WriteLine((s1 == s2) + " " + (s1 == null) + " " + (none == null) + " " + (none != s1));
                Action m1 = b + e, m2 = b + e, m3 = e + b, m4 = b + e + b;
                Console.WriteLine((m1 == m2) + " " + (m1 == m3) + " " + (m1 == m4) + " " + (m4 - b == m1));
                Func<int> l1 = () => 1, l2 = l1;
                Console.WriteLine(l1 == l2);
            }
        }
      `,
    ),
  ]),
];
