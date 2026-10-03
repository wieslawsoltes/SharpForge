/**
 * Differential fixtures for SF-A02-T10.4: init accessors (C# 9) and required members (C# 11) - where an init-only
 * member may be assigned (CS8852), which creations must set which members (CS9035), the declaration rules of
 * `required`, and the language-version gates of both.
 */
import { cs, out, diag, feature } from './kit.js';

const init = [
  out(
    'init-accessors-run-in-initializers-and-constructors',
    cs`
    using System;
    class P
    {
        int backing;
        public int X { get; init; }
        public string Name { get; init; } = "none";
        public int Y { get { return backing; } init { Console.WriteLine("init Y " + value); backing = value * 2; } }
        public int Z { get { return backing + 1; } init { Y = value; X = value; } }
        public P() { X = 1; }
        public P(int x) : this() { X = x; this.Y = x; }
        public P With(int x) { return new P { X = x, Name = Name, Y = 3 }; }
    }
    class Program
    {
        static void Main()
        {
            var p = new P { X = 5, Y = 4 };
            var q = new P(7);
            var r = p.With(9);
            var s = new P { Z = 6 };
            Console.WriteLine(p.X + p.Name + p.Y + " " + q.X + q.Y + " " + r.X + r.Name + r.Y + " " + s.X + s.Z);
        }
    }
  `,
  ),
  diag(
    'init-only-assignment-outside-initialization',
    cs`
    class P
    {
        public int X { get; init; }
        public int this[int i] { get { return 0; } init { } }
        public void Set() { X = 1; this.X = 2; this[0] = 1; }
        public int Z { get { return 0; } init { X = value; } }
        public static void Other(P p) { p.X = 3; }
        public P() { var o = new P(); o.X = 1; X = 2; this[1] = 3; }
    }
    class Program
    {
        static void Main()
        {
            var p = new P { X = 5, [2] = 4 };
            p.X = 6;
            p.X++;
            p.X += 2;
            p[1] = 2;
            System.Action a = () => p.X = 1;
        }
    }
  `,
  ),
  diag(
    'init-accessor-declaration-errors',
    cs`
    class Q
    {
        public static int S { get; init; }
        public int Both { get; set; init; }
        public int Twice { init { } init { } }
    }
    class Program { static void Main() { } }
  `,
  ),
  diag(
    'init-accessor-in-lambda-inside-constructor',
    cs`
    class P
    {
        public int X { get; init; }
        public P()
        {
            System.Action a = () => { X = 1; };
            void Local() { X = 2; }
            Local();
        }
    }
    class Program { static void Main() { } }
  `,
  ),
  diag(
    'init-language-version',
    cs`
    class P { public int X { get; init; } }
    class Program { static void Main() { } }
  `,
    { langVersion: '8' },
  ),
];

const required = [
  out(
    'required-members-set-by-initializers',
    cs`
    using System;
    class P
    {
        public required int X { get; set; }
        public required string Name;
        public required int Scale { get; init; }
        public int Optional { get; init; }
        public P() { Console.WriteLine("ctor"); }
    }
    class Program
    {
        static P Make(int x) { return new P { X = x, Name = "made", Scale = 2 }; }
        static void Main()
        {
            var p = new P { X = 5, Name = "n", Scale = 1 };
            P r = new() { Name = "t", X = 1, Optional = 2, Scale = 3 };
            Console.WriteLine(p.X + p.Name + p.Scale + " " + r.X + r.Name + r.Optional + r.Scale + " " + Make(4).X);
        }
    }
  `,
  ),
  diag(
    'required-member-must-be-set',
    cs`
    class P
    {
        public required int X { get; set; }
        public required string Name;
        public int Free;
    }
    class Program
    {
        static void Main()
        {
            var a = new P { X = 5 };
            var b = new P();
            P c = new();
            var d = new P { Name = "n", Free = 1 };
            var e = new P { X = 1, Name = "ok" };
        }
    }
  `,
  ),
  diag(
    'sets-required-members',
    cs`
    using System.Diagnostics.CodeAnalysis;
    class P
    {
        public required int X { get; set; }
        public P() { }
        [SetsRequiredMembers]
        public P(int x) { X = x; }
        [SetsRequiredMembersAttribute]
        public P(string s) { }
        public P(double d) : this(1) { }
        public P(bool b) : this() { }
    }
    class Program
    {
        static void Main()
        {
            var a = new P(1);
            var b = new P("s");
            var c = new P(1.5);
            var d = new P(true);
            var e = new P();
        }
    }
  `,
  ),
  diag(
    'required-declaration-errors',
    cs`
    public class P
    {
        required int Hidden;
        internal required int Lower { get; set; }
        public required static int S;
        public required int ReadOnly { get; }
        public required readonly int Ro;
        public required const int K = 1;
        public required int PrivateSet { get; private set; }
        public required void M() { }
        public required int Fine { get; init; }
    }
    class Program { static void Main() { } }
  `,
  ),
  diag(
    'required-and-nested-initializers',
    cs`
    class Inner { public int V; }
    class D
    {
        public required Inner A { get; init; }
        public required int[] B;
    }
    class Program
    {
        static void Main()
        {
            var f = new D { A = { V = 1 }, B = { [0] = 1 } };
            var g = new D { A = new Inner(), B = new int[1] };
        }
    }
  `,
  ),
  diag(
    'required-new-constraint',
    cs`
    class D { public required int A { get; set; } }
    class E { public int A { get; set; } }
    class Program
    {
        static T Make<T>() where T : new() { return new T(); }
        static void Main()
        {
            var g = Make<D>();
            var h = Make<E>();
        }
    }
  `,
  ),
  diag(
    'required-language-version',
    cs`
    class P { public required int X { get; set; } }
    class Program { static void Main() { var p = new P { X = 1 }; } }
  `,
    { langVersion: '10' },
  ),
];

export const fixtures = [...feature('member-init', init), ...feature('member-required', required)];
