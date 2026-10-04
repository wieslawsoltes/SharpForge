/**
 * Differential fixtures for SF-A02-T75 and the other C# 10 rules of SF-A02-E09: constant interpolated strings,
 * natural types and explicit return types of lambdas, `[CallerArgumentExpression]` and extended property patterns.
 * Struct constructors and field initializers bind (their rules are pinned here) but structs do not execute.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('constant-interpolation', [
    out(
      'constants-fold-in-fields-locals-labels-and-patterns',
      cs`
    using System;
    class Program
    {
        const string A = "a";
        const string B = $"{A}b";
        const string C = $"{B}{A}" + "!";
        static string Default(string s = $"{A}?") => s;
        static void Main()
        {
            const string L = $"<{C}>";
            Console.WriteLine(B);
            Console.WriteLine(L);
            Console.WriteLine(Default());
            switch ("ab") { case $"{A}b": Console.WriteLine("hit"); break; }
            string text = "aba!";
            Console.WriteLine(text is $"{B}{A}!");
        }
    }
  `,
    ),
    out(
      'doubled-braces-are-one-brace',
      cs`
    using System;
    class Program
    {
        const string Name = "n";
        const string Braces = $"{{{Name}}}";
        static void Main()
        {
            int x = 1;
            Console.WriteLine(Braces);
            Console.WriteLine($"{{{x}}}");
            Console.WriteLine($@"a\{{b}}{x}");
            Console.WriteLine($"tab\t{{}}{x}");
            Console.WriteLine($$"""{ {{x}} }""");
        }
    }
  `,
    ),
    diag(
      'cs0133-holes-must-be-constant-strings',
      cs`
    class Program
    {
        const int N = 1;
        const string A = "a";
        const string B = $"{N}";
        const string C = $"{A,3}";
        const string D = $"{A:x}";
        const string E = $"{null}";
        const object F = $"{A}";
        const object G = "text";
        const object H = null;
        static void Main() { string v = "v"; const string L = $"{v}"; }
    }
  `,
    ),
    diag(
      'constant-interpolation-in-csharp-9',
      cs`
    class Program
    {
        const string A = "a";
        const string B = $"{A}b";
        static void Main() { System.Console.WriteLine($"{A}c"); }
    }
  `,
      { langVersion: '9' },
    ),
  ]),
  ...feature('lambda-natural-type', [
    out(
      'var-takes-the-natural-delegate-type',
      cs`
    using System;
    class Program
    {
        static int Twice(int v) => v * 2;
        static void Hello() { Console.WriteLine("hello"); }
        static void Main()
        {
            var f = (int x) => x * 2; Console.WriteLine(f(4));
            var g = () => "s"; Console.WriteLine(g());
            var h = int (bool b) => b ? 1 : 0; Console.WriteLine(h(true));
            var m = Twice; Console.WriteLine(m(5));
            var a = Hello; a();
            var act = (string s) => Console.WriteLine(s); act("act");
            var nested = () => (int y) => y + 1; Console.WriteLine(nested()(1));
        }
    }
  `,
    ),
    diag(
      'cs8917-no-natural-type',
      cs`
    using System;
    class Program
    {
        static void O() { }
        static void O(int x) { }
        static T G<T>(T t) => t;
        static void Main()
        {
            var f = x => x;
            var g = () => null;
            var o = O;
            var gen = G;
            var d = delegate { };
            object obj = x => x;
            var blk = (int x) => { if (x > 0) return 1; return "s"; };
            var n = (int x) => null;
        }
    }
  `,
    ),
    diag(
      'explicit-return-type-must-match',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            var a = string (int x) => x;
            var b = void () => 1;
            var c = int () => { };
            Func<object> d = string () => "s";
            Func<string> e = object () => "s";
            Func<int, long> ok = long (int x) => x;
        }
    }
  `,
    ),
    diag(
      'natural-types-in-csharp-9',
      cs`
    using System;
    class Program
    {
        static int T(int v) => v;
        static void Main()
        {
            var f = (int x) => x * 2;
            var m = T;
            object o = () => 1;
            Delegate d = T;
            var h = int (bool b) => 1;
            Func<int, int> k = [Obsolete] (x) => x;
        }
    }
  `,
      { langVersion: '9' },
    ),
  ]),
  ...feature('caller-argument-expression', [
    out(
      'omitted-arguments-take-the-source-text',
      cs`
    using System;
    using System.Runtime.CompilerServices;
    class Guard
    {
        public string Text;
        public Guard(int value, [CallerArgumentExpression("value")] string text = "") { Text = text; }
    }
    class Program
    {
        static void Check(bool c, [CallerArgumentExpression("c")] string e = null) { Console.WriteLine(e); }
        static void Two(int a, int b, [CallerArgumentExpression("b")] string eb = "?", [CallerArgumentExpression("a")] string ea = "?")
        {
            Console.WriteLine(ea + "|" + eb);
        }
        static void Opt(int a = 5, [CallerArgumentExpression("a")] string e = "none") { Console.WriteLine(e); }
        static void Main()
        {
            int x = 1;
            Check(x > 0);
            Check(  x   ==   1 );
            Check(c: x != 2);
            Check(true, "given");
            Two(1 + 2, x * 3);
            Two(b: 9, a: 8);
            Opt();
            Opt(7);
            Check(/* note */ x < 5 /* after */);
            Check((x) > (0));
            Console.WriteLine(new Guard(x + 1).Text);
        }
    }
  `,
    ),
    diag(
      'attribute-rules',
      cs`
    using System.Runtime.CompilerServices;
    class Program
    {
        static void A(int c, [CallerArgumentExpression("nope")] string e = null) { }
        static void B(int c, [CallerArgumentExpression("e")] string e = null) { }
        static void C(int c, [CallerArgumentExpression("c")] string e) { }
        static void D(int c, [CallerArgumentExpression("c")] int e = 0) { }
        static void E(int c, [CallerArgumentExpression("c")] object e = null) { }
        static void Main() { }
    }
  `,
    ),
  ]),
  ...feature('extended-property-patterns', [
    out(
      'member-paths-are-nested-patterns',
      cs`
    using System;
    class A { public B B = new B(); public B N = null; }
    class B { public int V = 3; public C C = new C(); }
    class C { public string S = "s"; public int Len => S.Length; }
    class Program
    {
        static void Main()
        {
            var a = new A();
            if (a is { B.V: 3 }) Console.WriteLine("ok");
            Console.WriteLine(a is { B.V: > 5 });
            Console.WriteLine(a is { B.C.S: "s", B.C.Len: 1 });
            Console.WriteLine(a is { N.V: 3 });
            Console.WriteLine(a switch { { B.C.S.Length: 1 } => "one", _ => "other" });
            if (a is { B.C: { S: var s } c }) Console.WriteLine(s + c.Len);
        }
    }
  `,
    ),
    diag(
      'member-path-errors',
      cs`
    class A { public B B = null; }
    class B { public int V = 0; public void M() { } }
    class Program
    {
        static void Main()
        {
            var a = new A();
            bool x = a is { B.Nope: 3 };
            bool y = a is { B.V.Foo: 3 };
            bool z = a is { B.M: 3 };
            bool w = a is { B.V: "s" };
            bool q = a is { a.B: null };
            bool m = a is { M: 3 };
        }
    }
  `,
    ),
    diag(
      'extended-property-patterns-in-csharp-9',
      cs`
    class A { public B B = null; }
    class B { public int V = 0; }
    class Program
    {
        static void Main() { var a = new A(); bool x = a is { B.V: 3 }; }
    }
  `,
      { langVersion: '9' },
    ),
  ]),
  ...feature('struct-initialization', [
    diag(
      'constructors-and-field-initializers',
      cs`
    struct NoConstructor { public int X = 5; public int Twice => X * 2; }
    struct PrivateConstructor { private PrivateConstructor() { } }
    struct Fine { public int X = 5; public int Y; public Fine() { Y = 2; } public int Sum => X + Y; }
    struct Partly { public int X; public int Y = 1; public Partly(int x) { X = x; } public int Sum => X + Y; }
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'struct-initialization-in-csharp-9',
      cs`
    struct Fine { public int X = 5; public Fine() { } public int Twice => X * 2; }
    class Program { static void Main() { } }
  `,
      { langVersion: '9' },
    ),
  ]),
];
