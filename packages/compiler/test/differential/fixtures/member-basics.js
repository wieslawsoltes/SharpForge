/**
 * Differential fixtures for the member forms of SF-A02-T10.1 (properties), SF-A02-T10.3 (const and readonly fields),
 * constructors and static constructors (SF-A02-T03.4) and call-site arguments (SF-A02-T06.3): what they print on
 * .NET and what Roslyn reports when they are declared or used wrongly.
 */
import { cs, out, diag, feature } from './kit.js';

const properties = [
  out(
    'accessor-forms',
    cs`
    using System;
    class P
    {
        int backing;
        public int Auto { get; set; }
        public int GetOnly { get; }
        public int Initialized { get; } = 5;
        public static int Count { get; private set; }
        public int Full { get { return backing; } set { backing = value < 0 ? 0 : value; } }
        public int Expression => backing * 2;
        public int Arrow { get => backing; set => backing = value; }
        public string Text { get; set; } = "t";
        public P(int g) { GetOnly = g; Count++; }
    }
    class Program
    {
        static P Make(int g) { Console.WriteLine("make " + g); return new P(g); }
        static void Main()
        {
            var p = new P(3) { Auto = 1, Full = -5 };
            p.Arrow = 4;
            p.Auto += 2;
            p.Auto++;
            p.Text += "ext";
            Make(9).Auto += 1;
            int old = p.Full++;
            Console.WriteLine(p.Auto + " " + p.GetOnly + " " + p.Initialized + " " + P.Count + " " + p.Full + " " + p.Expression + " " + old + " " + p.Text);
        }
    }
  `,
  ),
  out(
    'static-properties-and-accessor-order',
    cs`
    using System;
    class Config
    {
        static int level = 1;
        public static int Level { get { Console.WriteLine("get"); return level; } set { Console.WriteLine("set " + value); level = value; } }
        public static string Name { get; set; } = "cfg";
        public static int Twice => Level * 2;
    }
    class Program
    {
        static int Value() { Console.WriteLine("value"); return 5; }
        static void Main()
        {
            Config.Level = Value();
            Config.Level += Value();
            Console.WriteLine(Config.Twice + Config.Name);
        }
    }
  `,
  ),
  diag(
    'property-use-errors',
    cs`
    class P
    {
        public int GetOnly { get; }
        public int SetOnly { set { } }
        public int PrivateSet { get; private set; }
        public int PrivateGet { private get; set; }
        public static int S { get; set; }
        public void M() { GetOnly = 1; }
    }
    class Program
    {
        static void Main()
        {
            var p = new P();
            p.GetOnly = 1;
            int a = p.SetOnly;
            p.PrivateSet = 2;
            int b = p.PrivateGet;
            p.S = 3;
            P.GetOnly = 4;
            p.GetOnly++;
        }
    }
  `,
  ),
  diag(
    'property-declaration-errors',
    cs`
    class P
    {
        int stored;
        public int NoAccessors { }
        public int Both { private get; private set; }
        public int Wider { get; public set; }
        private int Same { get; private set; }
        public int NotAuto { get { return stored; } set { stored = value; } } = 5;
        public int Twice { get; get; }
        public void Void { get; set; }
    }
    class Program { static void Main() { } }
  `,
  ),
];

const fields = [
  out(
    'const-readonly-and-static-readonly',
    cs`
    using System;
    class Limits
    {
        public const int Max = 10;
        public const int Double = Max * 2;
        public const string Name = "limit" + "s";
        const bool Flag = Max > 5;
        public static readonly int Computed = Compute();
        public readonly int Instance;
        readonly int[] items = new int[2];
        static int Compute() { Console.WriteLine("compute"); return Double + 1; }
        public Limits(int i) { Instance = i; Instance += Max; items[0] = i; }
        public int First => items[0];
        public static bool IsBig => Flag;
    }
    class Program
    {
        const int Local = Limits.Max + 1;
        static void Main()
        {
            const int inner = Local * 2;
            Console.WriteLine(Limits.Max + " " + Limits.Double + " " + Limits.Name + " " + inner);
            var l = new Limits(4);
            Console.WriteLine(l.Instance + " " + l.First + " " + Limits.Computed + " " + Limits.IsBig);
        }
    }
  `,
  ),
  diag(
    'const-errors',
    cs`
    class C
    {
        const int A = B;
        const int B = A;
        const int NoValue;
        const int NotConstant = Compute();
        static const int Static = 1;
        const C Reference = new C();
        const string Null = null;
        static int Compute() { return 1; }
        void M() { Null = "n"; const int local = Compute(); }
    }
    class Program { static void Main() { } }
  `,
  ),
  diag(
    'readonly-errors',
    cs`
    class C
    {
        readonly int instance = 1;
        static readonly int shared = 2;
        public C() { instance = 3; shared = 4; }
        static C() { shared = 5; }
        void M() { instance = 6; shared = 7; instance++; }
        static void Take(ref int x) { }
        void N() { Take(ref instance); Take(ref shared); }
        int Read() { return instance + shared; }
    }
    class Program { static void Main() { var c = new C(); } }
  `,
  ),
];

const constructors = [
  out(
    'static-constructor-timing',
    cs`
    using System;
    class Eager
    {
        public static int Value = Log("Eager.Value");
        public static int Log(string s) { Console.WriteLine(s); return 1; }
    }
    class Precise
    {
        public static int Value = Eager.Log("Precise.Value");
        static Precise() { Console.WriteLine("Precise cctor"); }
        public static void Touch() { Console.WriteLine("touch"); }
        public Precise() { Console.WriteLine("Precise ctor"); }
    }
    static class Tools
    {
        static int count;
        static Tools() { Console.WriteLine("Tools cctor"); count = 10; }
        public static int Next() { return ++count; }
        public const int K = 3;
    }
    class Program
    {
        static void Main()
        {
            Console.WriteLine("main");
            Console.WriteLine(Tools.K);
            Console.WriteLine(Tools.Next());
            Precise.Touch();
            new Precise();
            Console.WriteLine(Precise.Value + Tools.Next());
        }
    }
  `,
  ),
  out(
    'chained-constructors-and-initializers',
    cs`
    using System;
    class Shape
    {
        int sides = Log("field sides", 0);
        string name = "shape";
        static int Log(string s, int v) { Console.WriteLine(s); return v; }
        public Shape() : this(Log("default argument", 4)) { Console.WriteLine("Shape()"); }
        public Shape(int sides) : this(sides, "polygon") { Console.WriteLine("Shape(int)"); }
        public Shape(int sides, string name) { Console.WriteLine("Shape(int,string) " + this.sides + this.name); this.sides = sides; this.name = name; }
        public string Describe() { return name + sides; }
    }
    class Program
    {
        static void Main()
        {
            Console.WriteLine(new Shape().Describe());
            Console.WriteLine(new Shape(3, "triangle").Describe());
        }
    }
  `,
  ),
  diag(
    'constructor-errors',
    cs`
    class A
    {
        public A(int x) : this(x) { }
        public A(string s) : this(s, 1) { }
        public A(string s, int i) : this(s) { }
        public A(double d) : this() { }
        static A(int x) { }
        public static A() { }
        A(bool b) { }
        A(bool c) { }
        public void A() { }
    }
    class Program { static void Main() { var a = new A(); var b = new A(true); } }
  `,
  ),
];

const args = [
  out(
    'named-optional-and-params-evaluation-order',
    cs`
    using System;
    class Program
    {
        static int F(int a, int b = 2, params int[] rest) { int s = a * 100 + b * 10; foreach (var r in rest) s += r; return s; }
        static string G(string text = "d", int count = 1, bool upper = false) { return text + count + upper; }
        static int Log(int v) { Console.WriteLine("arg " + v); return v; }
        static int Sum(params int[] values) { int s = 0; foreach (var v in values) s += v; return s + values.Length * 1000; }
        static void Main()
        {
            Console.WriteLine(F(1));
            Console.WriteLine(F(1, 3, 4, 5));
            Console.WriteLine(F(b: Log(7), a: Log(1)));
            Console.WriteLine(F(Log(2), rest: new int[] { 1, 2 }, b: Log(3)));
            Console.WriteLine(G() + " " + G(count: 3) + " " + G("x", upper: true));
            Console.WriteLine(Sum() + " " + Sum(1) + " " + Sum(1, 2, 3) + " " + Sum(new int[] { 4, 5 }));
        }
    }
  `,
  ),
  diag(
    'argument-errors',
    cs`
    class Program
    {
        static int F(int a, int b = 2) { return a + b; }
        static int P(params int[] rest) { return rest.Length; }
        static void Main()
        {
            F();
            F(1, 2, 3);
            F(c: 1);
            F(1, a: 2);
            F(a: 1, a: 2);
            F(b: 1);
            F(a: 1, 2);
            P(1, "two");
            P(rest: 1);
        }
    }
  `,
  ),
  diag(
    'parameter-declaration-errors',
    cs`
    class Program
    {
        static int Compute() { return 1; }
        static void A(int a = 1, int b) { }
        static void B(params int[] rest, int last) { }
        static void C(params int rest) { }
        static void D(int a = "text") { }
        static void E(int a = Compute()) { }
        static void G(ref int a = 1) { }
        static void H(params int[] rest = null) { }
        static void Main() { }
    }
  `,
  ),
];

export const fixtures = [
  ...feature('member-properties', properties),
  ...feature('member-fields', fields),
  ...feature('member-constructors', constructors),
  ...feature('member-arguments', args),
];
