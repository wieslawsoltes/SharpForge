/**
 * Differential fixtures for SF-A02-T75 and SF-A02-T80: natural function types that need a synthesized delegate type,
 * default values and `params` in lambda parameters (C# 12), `ref readonly` parameters at the call site, the
 * interceptors policy (always rejected) and uses of inline arrays.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('lambda-defaults', [
    out(
      'defaults-and-params',
      cs`
        using System;
        class Program
        {
            delegate int WithDefault(int x = 5);
            static int Sum(params int[] v) { int s = 0; foreach (var x in v) s += x; return s; }
            static void Main()
            {
                var add = (int x, int y = 10) => x + y;
                Console.WriteLine(add(1));
                Console.WriteLine(add(1, 2));
                var total = (params int[] values) => Sum(values);
                Console.WriteLine(total(1, 2, 3));
                Console.WriteLine(total());
                var text = (string s = "none") => s;
                Console.WriteLine(text());
                WithDefault d = (int x = 5) => x * 2;
                Console.WriteLine(d());
                var joined = (string head, params string[] rest) => head + rest.Length;
                Console.WriteLine(joined("h", "a", "b") + joined("h"));
                var flag = (bool on = true, string s = null, double d = 1.5) => on + " " + (s == null) + " " + d;
                Console.WriteLine(flag());
                Console.WriteLine(flag(false, "x"));
            }
        }
      `,
    ),
    out(
      'synthesized-delegate-types',
      cs`
        using System;
        class Program
        {
            static int Six(int a, int b, int c, int d, int e, int f = 6) => a + b + c + d + e + f;
            static void Main()
            {
                var five = (int a, int b, int c, int d, int e) => a + b + c + d + e;
                Console.WriteLine(five(1, 2, 3, 4, 5));
                var six = Six;
                Console.WriteLine(six(1, 1, 1, 1, 1));
                Console.WriteLine(six(1, 1, 1, 1, 1, 1));
                var a = (int x, int y = 10) => x + y;
                var b = (int x, int y = 10) => x * y;
                a = b;
                Console.WriteLine(a(2));
            }
        }
      `,
    ),
    diag(
      'cs9099-cs9100-target-differs',
      cs`
        using System;
        class Program
        {
            delegate int WithDefault(int x = 5);
            delegate int Plain(int x);
            delegate int Many(params int[] v);
            static void Main()
            {
                WithDefault same = (int x = 5) => x;
                WithDefault other = (int x = 6) => x;
                Plain none = (int x = 6) => x;
                Many many = (int[] v) => 1;
                Func<int[], int> f = (params int[] v) => 1;
                Plain notParams = (params int[] v) => 1;
            }
        }
      `,
    ),
    diag(
      'cs1736-cs1750-cs1737-declaration',
      cs`
        class Program
        {
            static int Compute() => 1;
            static void Main()
            {
                var bad = (int x = Compute()) => x;
                var wrong = (int x = "s") => x;
                var order = (int x = 1, int y) => x;
            }
        }
      `,
    ),
    diag(
      'cs0029-natural-types-differ',
      cs`
        class Program
        {
            static int Twice(ref int x) { x *= 2; return x; }
            static void Main()
            {
                var add = (int x, int y = 10) => x + y;
                add = 1;
                var byRef = (ref int x) => x++;
                byRef = 2;
                var group = Twice;
                group = 4;
                var same = (int x, int y = 10) => x - y;
                add = same;
                var differ = (int x, int y = 11) => x - y;
                add = differ;
            }
        }
      `,
    ),
  ]),
  ...feature('ref-readonly-arguments', [
    diag(
      'cs9192-cs9193-cs9191-cs9200',
      cs`
        using System;
        class Program
        {
            static int field = 1;
            static void Read(ref readonly int value) { Console.WriteLine(value); }
            static void Plain(in int value) { }
            static void Write(ref int value) { }
            static int Make() => 3;
            static void Default(ref readonly int value = 5) { }
            static void Main()
            {
                int local = 2;
                Read(ref local);
                Read(in local);
                Read(local);
                Read(5);
                Read(Make());
                Read(ref field);
                Read(out local);
                Plain(ref local);
                Write(in local);
                const int k = 1;
                Read(k);
                Read(in k);
                Read(ref k);
            }
            static void Inner(ref readonly int p) { p = 1; Write(ref p); Read(ref p); Read(in p); }
        }
      `,
    ),
    diag(
      'cs9194-ref-for-in-below-12',
      cs`
        class Program
        {
            static void Plain(in int value) { }
            static void Main() { int local = 2; Plain(ref local); Plain(in local); Plain(local); }
        }
      `,
      { langVersion: '11' },
    ),
  ]),
  ...feature('interceptors', [
    diag(
      'always-rejected',
      cs`
        using System;
        using System.Runtime.CompilerServices;
        namespace System.Runtime.CompilerServices
        {
            [AttributeUsage(AttributeTargets.Method, AllowMultiple = true)]
            sealed class InterceptsLocationAttribute : Attribute
            {
                public InterceptsLocationAttribute(int version, string data) { }
                public InterceptsLocationAttribute(string filePath, int line, int character) { }
            }
        }
        namespace Generated
        {
            static class Interceptors
            {
                [InterceptsLocation(1, "data")]
                public static void Replacement() { }
                [InterceptsLocation("Program.cs", 1, 1)]
                public static void Older() { }
                [InterceptsLocation(2, "AAAA")]
                public static void Newer() { }
            }
        }
        static class Global
        {
            [InterceptsLocation("Program.cs", 1, 1)]
            public static void Older() { }
        }
        class Program
        {
            static void Main() { }
        }
      `,
    ),
  ]),
  ...feature('inline-arrays', [
    diag(
      'element-access-rules',
      cs`
        using System;
        using System.Runtime.CompilerServices;
        [InlineArray(4)] struct Buffer { private int element; }
        class Holder { public Buffer Field; public readonly Buffer Fixed; public Buffer Property { get; set; } }
        class Program
        {
            static Buffer Make() => new Buffer();
            static void Main()
            {
                Buffer b = new Buffer();
                b[0] = 2;
                b[3] += 5;
                int sum = b[0] + b[3];
                foreach (var x in b) sum += x;
                b[4] = 1;
                b[-1] = 1;
                b["s"] = 1;
                b[0, 1] = 1;
                var h = new Holder();
                h.Field[1] = 3;
                h.Fixed[1] = 3;
                h.Property[1] = 3;
                Make()[1] = 3;
                long wide = b[1L];
                ref int r = ref b[2];
                string s = b[0];
            }
        }
      `,
    ),
    diag(
      'gate-below-12',
      cs`
        using System.Runtime.CompilerServices;
        [InlineArray(4)] struct Buffer { private int element; }
        class Program
        {
            static void Main()
            {
                Buffer b = new Buffer();
                b[0] = 2;
                int sum = b[1];
                foreach (var x in b) sum += x;
            }
        }
      `,
      { langVersion: '11' },
    ),
  ]),
];
