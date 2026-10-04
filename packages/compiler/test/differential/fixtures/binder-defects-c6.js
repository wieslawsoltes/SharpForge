/**
 * Differential fixtures for three binder defects reported against the C# 1-6 rules: null-conditional element access
 * (`a?[i]`), `??` over `T?` of a struct-constrained type parameter (a false CS0019), and CS0162 in methods that use
 * `goto` (it was not reported there at all).
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('null-conditional-element', [
    out(
      'arrays-and-indexers',
      cs`
        using System;
        using System.Collections.Generic;
        class Program
        {
            static void Main()
            {
                int[] a = null;
                Console.WriteLine(a?[0] ?? -1);
                a = new[] { 7, 8 };
                Console.WriteLine(a?[1] ?? -1);
                string[] names = { "x", "y" };
                Console.WriteLine(names?[1] ?? "none");
                names = null;
                Console.WriteLine(names?[1] ?? "none");
                var list = new List<int> { 1, 2 };
                Console.WriteLine(list?[1]);
                Console.WriteLine(a?[0] == 7);
            }
        }
      `,
    ),
    diag(
      'cs0021-cs0029-invalid-element-access',
      cs`
        class Program
        {
            static void Main()
            {
                int[] a = null;
                object o = null;
                var x = o?[0];
                var y = a?["s"];
                int z = a?[0];
            }
        }
      `,
    ),
  ]),
  ...feature('nullable-coalesce', [
    diag(
      'cs0019-only-for-unrelated-operands',
      cs`
        class Program
        {
            static T? First<T>(T? a, T? b) where T : struct { return a ?? b; }
            static T Value<T>(T? a, T b) where T : struct { return a ?? b; }
            static T? Chain<T>(T? a, T? b, T? c) where T : struct { return a ?? b ?? c; }
            static void Main()
            {
                int? x = null, y = 2;
                int? z = x ?? y;
                int w = x ?? 5;
                long? l = x ?? 3L;
                string s = x ?? "s";
                System.Console.WriteLine(z + " " + w + l);
            }
        }
      `,
    ),
  ]),
  ...feature('goto-reachability', [
    diag(
      'cs0162-in-methods-with-goto-and-labels',
      cs`
        using System;
        class Program
        {
            static int A()
            {
                goto end;
                Console.WriteLine("dead");
            end:
                return 1;
                Console.WriteLine("dead2");
            }
            static void B(int n)
            {
            top:
                if (n > 0) { n--; goto top; }
                return;
                Console.WriteLine("dead3");
            }
            static void C()
            {
                goto skip;
                int x = 1;
                Console.WriteLine(x);
            skip:
                Console.WriteLine("ok");
                while (true) { goto done; }
                Console.WriteLine("dead4");
            done:;
            }
            static void D(int n)
            {
                switch (n) { case 1: goto case 2; Console.WriteLine("dead5"); case 2: break; default: goto default2; }
                return;
            default2:
                throw new Exception();
                Console.WriteLine("dead6");
            }
            static void Main() { }
        }
      `,
    ),
    out(
      'code-after-a-label-runs',
      cs`
        using System;
        class Program
        {
            static void Main()
            {
                int n = 0;
            again:
                n++;
                if (n < 3) goto again;
                Console.WriteLine(n);
                goto end;
            end:
                Console.WriteLine("end");
            }
        }
      `,
    ),
  ]),
];
