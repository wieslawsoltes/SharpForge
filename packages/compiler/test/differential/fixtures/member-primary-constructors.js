/**
 * Differential fixtures for SF-A02-T10.5: primary constructors on classes and structs (C# 12) - parameter scope,
 * capture into the state of the type, initialization order, chaining from other constructors and the diagnostics
 * Roslyn reports for them.
 */
import { cs, out, diag, feature } from './kit.js';

const outputs = [
  out(
    'capture-and-initialization',
    cs`
    using System;
    class Counter(int start, int step)
    {
        int current = start;
        public int Next() { current += step; return current; }
        public int Step => step;
        public void Faster() { step++; }
    }
    class Named(string name)
    {
        public string Name { get; } = name;
        public Named() : this("anonymous") { Console.WriteLine("default"); }
    }
    class Program
    {
        static void Main()
        {
            var c = new Counter(10, 5);
            c.Faster();
            Console.WriteLine(c.Next() + " " + c.Next() + " " + c.Step);
            var other = new Counter(1, 1);
            Console.WriteLine(other.Next() + " " + c.Step);
            Console.WriteLine(new Named().Name + new Named("x").Name);
        }
    }
  `,
  ),
  out(
    'initializer-order-and-lambdas',
    cs`
    using System;
    class Tracker(int seed, string label)
    {
        int a = Log("a", seed);
        int b = Log("b", seed + 1);
        Func<int> doubled = () => seed * 2;
        static int Log(string s, int v) { Console.WriteLine(s + v); return v; }
        public int Sum => a + b;
        public int Doubled() { return doubled(); }
        public string Describe() { Func<string> text = () => label + ":" + a; return text(); }
        public Tracker(int seed) : this(Log("chained", seed), "chained") { Console.WriteLine("body"); }
    }
    class Program
    {
        static void Main()
        {
            var t = new Tracker(3, "first");
            Console.WriteLine(t.Sum + " " + t.Doubled() + " " + t.Describe());
            var u = new Tracker(5);
            Console.WriteLine(u.Sum + " " + u.Doubled() + " " + u.Describe());
        }
    }
  `,
  ),
  out(
    'captured-parameter-is-mutable-state',
    cs`
    using System;
    class Account(int balance)
    {
        public void Deposit(int amount) { balance += amount; }
        public int Balance { get { return balance; } set { balance = value; } }
        public int this[int scale] => balance * scale;
        public event Action Changed { add { balance++; } remove { balance--; } }
    }
    class Program
    {
        static void Nothing() { }
        static void Main()
        {
            var a = new Account(10);
            a.Deposit(5);
            a.Balance += 2;
            a.Changed += Nothing;
            Console.WriteLine(a.Balance + " " + a[3]);
        }
    }
  `,
  ),
];

const diagnostics = [
  diag(
    'unread-and-double-storage',
    cs`
    class Unused(int value) { }
    class Double(int p)
    {
        int stored = p;
        public int P => p;
    }
    class Shadow(int x)
    {
        int x = x;
        public int X => x;
    }
    class Program { static void Main() { var a = new Unused(1); var b = new Double(2); var c = new Shadow(3); } }
  `,
  ),
  diag(
    'other-constructors-must-chain',
    cs`
    class A(int x)
    {
        public int X => x;
        public A() { }
        public A(string s) : this(1) { }
        public A(double d) : base() { }
    }
    class Program { static void Main() { var a = new A(1); } }
  `,
  ),
  diag(
    'parameter-in-static-and-nested-contexts',
    cs`
    class A(int x)
    {
        static int S() { return x; }
        static int F = x;
        class Nested { int M() { return x; } }
        public int Ok() { return x; }
    }
    class Program { static void Main() { var a = new A(1); } }
  `,
  ),
  diag(
    'parameter-rules',
    cs`
    class A(int x, int x) { public int X => x; }
    class B(ref int r) { public int R => r; }
    class C(int v)
    {
        public int V => v;
        void M() { int v = 1; }
        void N(int v) { }
    }
    struct S(int a) { public int A => a; }
    class Program { static void Main() { int i = 0; var b = new B(ref i); var c = new C(1); var s = new S(2); } }
  `,
  ),
  diag(
    'struct-capture-in-readonly-context',
    cs`
    struct S(int a)
    {
        public readonly int Read() { return a; }
        public readonly void Write() { a = 1; }
        public void Change() { a = 2; }
    }
    readonly struct R(int b)
    {
        public int B => b;
        public void Set() { b = 3; }
    }
    class Program { static void Main() { var s = new S(1); var r = new R(2); } }
  `,
  ),
  diag(
    'language-version',
    cs`
    class A(int x) { public int X => x; }
    class Program { static void Main() { var a = new A(1); } }
  `,
    { langVersion: '11' },
  ),
];

export const fixtures = feature('member-primary-constructors', [...outputs, ...diagnostics]);
