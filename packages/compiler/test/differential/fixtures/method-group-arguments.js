/**
 * Differential fixtures for SF-A02-T06.7 (method group conversions at call sites): a method group passed directly as
 * an argument of a method, constructor, indexer, delegate or `params` parameter is converted to the delegate type of
 * the parameter. The pinned output is what the same program prints on .NET.
 */
import { cs, out, diag, feature } from './kit.js';

const outputs = [
  out(
    'method-groups-as-arguments',
    cs`
    using System;
    delegate int Op(int x);
    class Calc
    {
        public int Factor = 3;
        public Calc() { }
        public Calc(Func<int, int> seed) { Factor = seed(1); }
        public int Scale(int x) { return x * Factor; }
        public static int Negate(int x) { return -x; }
        public int Use(Func<int, int> f) { return f(Factor); }
        public int Self() { return Use(Scale) + Use(this.Scale); }
        public int this[Func<int, int> f] { get { return f(2); } }
    }
    class Program
    {
        static int Twice(int x) { return x * 2; }
        static string Twice(string x) { return x + x; }
        static void Hello() { Console.WriteLine("hello"); }
        static int Apply(Func<int, int> f, int v) { return f(v); }
        static int ApplyOp(Op f, int v) { return f(v); }
        static T Map<T>(Func<T, T> f, T v) { return f(v); }
        static void Run(Action a) { a(); }
        static int Sum(params Func<int, int>[] fs) { int s = 0; foreach (var f in fs) s += f(1); return s; }
        static Func<int, int> Pick(bool first) { if (first) return Twice; return Calc.Negate; }
        static void Main()
        {
            Console.WriteLine(Apply(Twice, 4));
            Run(Hello);
            Console.WriteLine(ApplyOp(Twice, 4) + " " + ApplyOp(Calc.Negate, 4));

            var calc = new Calc();
            Console.WriteLine(Apply(calc.Scale, 4) + " " + calc.Use(Twice) + " " + calc.Self());
            var seeded = new Calc(Twice);
            Console.WriteLine(seeded.Factor + " " + seeded[Twice] + " " + seeded[seeded.Scale]);

            Console.WriteLine(Map<int>(Twice, 4));
            Console.WriteLine(Map<string>(Twice, "ab"));

            int offset = 5;
            int Add(int x) { return x + offset; }
            int Next(int x) { return x + 1; }
            Console.WriteLine(Apply(Add, 1) + " " + Apply(Next, 1));

            Console.WriteLine(Sum(Twice, Calc.Negate, calc.Scale));
            var table = new Func<int, int>[] { Twice, Calc.Negate };
            Console.WriteLine(table[0](3) + table[1](3));
            Console.WriteLine(Pick(true)(3) + Pick(false)(3));

            Func<Func<int, int>, int> ten = f => f(10);
            Console.WriteLine(ten(Twice));
            Action twice = Hello;
            twice += Hello;
            Run(twice);
        }
    }
  `,
  ),
  out(
    'method-groups-as-arguments-in-generic-code',
    cs`
    using System;
    class Box<T>
    {
        public T Value;
        public Box(T value) { Value = value; }
        public Box<R> Map<R>(Func<T, R> f) { return new Box<R>(f(Value)); }
        public T Same(T x) { return x; }
        public T Through() { return Apply(Same, Value); }
        static T Apply(Func<T, T> f, T v) { return f(v); }
    }
    static class Text
    {
        public static string Describe(int x) { return "n" + x; }
        public static int Length(string s) { return s.Length; }
        public static R Convert<T, R>(T value, Func<T, R> f) { return f(value); }
    }
    class Program
    {
        static void Main()
        {
            var number = new Box<int>(7);
            var text = number.Map<string>(Text.Describe);
            Console.WriteLine(text.Value);
            Console.WriteLine(text.Map<int>(Text.Length).Value);
            Console.WriteLine(number.Through() + " " + text.Through());
            Console.WriteLine(Text.Convert<string, int>("four", Text.Length));
        }
    }
  `,
  ),
];

const diagnostics = [
  diag(
    'cs1503-cs0123-method-group-argument-mismatch',
    cs`
    using System;
    class Program
    {
        static int Twice(int x) { return x * 2; }
        static void Hello() { }
        static int Apply(Func<int, int> f, int v) { return f(v); }
        static void Run(Action a) { a(); }
        static void Main()
        {
            Apply(Hello, 1);
            Run(Twice);
            Apply(Missing, 1);
            int n = Apply(Twice);
        }
    }
  `,
  ),
];

export const fixtures = feature('method-group-arguments', [...outputs, ...diagnostics]);
