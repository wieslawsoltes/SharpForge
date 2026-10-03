/**
 * Differential fixtures for user-defined indexers (SF-A02-T10.2), operators (SF-A02-T06.5) and conversions
 * (SF-A02-T06.4) as they execute through the semantic code generator, with the declaration and use-site errors
 * Roslyn reports for them.
 */
import { cs, out, diag, feature } from './kit.js';

const indexers = [
  out(
    'compound-assignment-and-increment',
    cs`
    using System;
    class Grid
    {
        int[] cells = new int[9];
        public int Gets, Sets;
        public int this[int i] { get { Gets++; return cells[i]; } set { Sets++; cells[i] = value; } }
        public int this[int r, int c] { get => cells[r * 3 + c]; set => cells[r * 3 + c] = value; }
        public string this[string k] => k + "!";
    }
    class Program
    {
        static int calls;
        static int Next() { return calls++; }
        static Grid made;
        static Grid Make() { Console.WriteLine("make"); return made; }
        static void Main()
        {
            var g = new Grid();
            made = g;
            g[2] += 5; g[1, 1]++; ++g[1, 1]; g[Next()] += 3; g[Next()]++;
            int old = g[2]++;
            int now = --g[2];
            g[3] = g[4] = 9;
            Make()[8] -= 2;
            Console.WriteLine(g[0] + " " + g[1] + " " + g[2] + " " + g[4] + " " + old + " " + now + " " + calls + " " + g["k"]);
            Console.WriteLine(g.Gets + " " + g.Sets + " " + g[8]);
        }
    }
  `,
  ),
  out(
    'index-read-before-right-side',
    cs`
    using System;
    class Row
    {
        double[] cells = new double[4];
        public double this[int i] { get { Console.WriteLine("get " + i); return cells[i]; } set { Console.WriteLine("set " + i + " " + value); cells[i] = value; } }
    }
    class Program
    {
        static void Main()
        {
            var row = new Row();
            int i = 1;
            row[i] += i++;
            row[i] *= 2;
            row[i++] = i;
            row[0]++;
            Console.WriteLine(i);
        }
    }
  `,
  ),
  out(
    'overloads-named-optional-and-params',
    cs`
    using System;
    class Table
    {
        public string this[int row, int column = 7] { get { return row + ":" + column; } }
        public string this[string key, params int[] rest] { get { return key + rest.Length; } }
        public int this[double scale] { get { return (int)(scale * 2); } }
    }
    class Program
    {
        static void Main()
        {
            var t = new Table();
            Console.WriteLine(t[1]);
            Console.WriteLine(t[column: 2, row: 3]);
            Console.WriteLine(t["k"] + " " + t["k", 1, 2, 3]);
            Console.WriteLine(t[1.5]);
        }
    }
  `,
  ),
  out(
    'static-and-instance-members-through-indexers',
    cs`
    using System;
    class Counter { public int Value; public int Total { get; set; } }
    class Registry
    {
        Counter[] counters = new Counter[] { new Counter(), new Counter() };
        public static int Reads;
        public Counter this[int i] { get { Reads++; return counters[i]; } }
    }
    class Program
    {
        static void Main()
        {
            var registry = new Registry();
            registry[0].Value += 4;
            registry[1].Total++;
            registry[1].Total += registry[0].Value;
            Console.WriteLine(registry[0].Value + " " + registry[1].Total + " " + Registry.Reads);
        }
    }
  `,
  ),
  diag(
    'use-site-errors',
    cs`
    class Grid
    {
        public int this[int i] { get { return 0; } }
        public int this[string k] { set { } }
        public int this[int a, int b] { get { return 0; } set { } }
    }
    class Plain { }
    class Program
    {
        static void Main()
        {
            var g = new Grid();
            g[0] = 1;
            int x = g["k"];
            g[1, 2, 3] = 4;
            g[1.5] = 2;
            g[0]++;
            g["k"] += 1;
            var p = new Plain();
            p[0] = 1;
        }
    }
  `,
  ),
  diag(
    'declaration-errors',
    cs`
    class Grid
    {
        public int this[int i] { get { return 0; } }
        public string this[int j] { get { return ""; } }
        public static int this[string s] { get { return 0; } }
        public int this[] { get { return 0; } }
        public int this[ref int r] { get { return 0; } }
    }
    class Program { static void Main() { } }
  `,
  ),
];

const operators = [
  out(
    'arithmetic-comparison-and-unary',
    cs`
    using System;
    class V
    {
        public int X;
        public V(int x) { X = x; }
        public static V operator +(V a, V b) => new V(a.X + b.X);
        public static V operator +(V a, int b) => new V(a.X + b);
        public static V operator -(V a) => new V(-a.X);
        public static V operator *(V a, V b) { return new V(a.X * b.X); }
        public static bool operator ==(V a, V b) => a.X == b.X;
        public static bool operator !=(V a, V b) => a.X != b.X;
        public static bool operator <(V a, V b) => a.X < b.X;
        public static bool operator >(V a, V b) => a.X > b.X;
        public static bool operator !(V a) => a.X == 0;
        public static V operator ~(V a) => new V(~a.X);
        public static V operator <<(V a, int n) => new V(a.X << n);
    }
    class Program
    {
        static void Main()
        {
            V a = new V(2), b = new V(3);
            V e = -(a + b) * b + 1;
            Console.WriteLine(e.X);
            Console.WriteLine(a == b);
            Console.WriteLine(a != b);
            Console.WriteLine(a < b);
            Console.WriteLine(a > b);
            Console.WriteLine(!a);
            Console.WriteLine((~a).X + " " + (a << 3).X);
        }
    }
  `,
  ),
  out(
    'compound-assignment-and-increment',
    cs`
    using System;
    class V
    {
        public int X;
        public V(int x) { X = x; }
        public static V operator +(V a, V b) { Console.WriteLine("+ " + a.X + " " + b.X); return new V(a.X + b.X); }
        public static V operator ++(V a) { Console.WriteLine("++ " + a.X); return new V(a.X + 1); }
        public static V operator --(V a) { Console.WriteLine("-- " + a.X); return new V(a.X - 1); }
    }
    class Holder
    {
        V[] items = new V[] { new V(10), new V(20) };
        public V Field = new V(1);
        public V Property { get; set; } = new V(2);
        public static V Shared = new V(3);
        public V this[int i] { get { Console.WriteLine("get " + i); return items[i]; } set { Console.WriteLine("set " + i); items[i] = value; } }
    }
    class Program
    {
        static Holder holder = new Holder();
        static Holder Get() { Console.WriteLine("holder"); return holder; }
        static void Main()
        {
            V local = new V(5);
            V before = local++;
            V after = ++local;
            local += before;
            Console.WriteLine(local.X + " " + before.X + " " + after.X);
            Get().Field += local;
            Get().Property++;
            Holder.Shared--;
            V old = Get()[1]++;
            Get()[0] += old;
            Console.WriteLine(holder.Field.X + " " + holder.Property.X + " " + Holder.Shared.X + " " + old.X);
        }
    }
  `,
  ),
  out(
    'true-false-and-short-circuit',
    cs`
    using System;
    class T
    {
        public int X;
        public T(int x) { X = x; }
        public static bool operator true(T t) { Console.WriteLine("true? " + t.X); return t.X != 0; }
        public static bool operator false(T t) { Console.WriteLine("false? " + t.X); return t.X == 0; }
        public static T operator &(T a, T b) { Console.WriteLine("and"); return new T(a.X & b.X); }
        public static T operator |(T a, T b) { Console.WriteLine("or"); return new T(a.X | b.X); }
    }
    class Program
    {
        static T Make(int x) { Console.WriteLine("make " + x); return new T(x); }
        static void Main()
        {
            if (Make(1)) Console.WriteLine("yes");
            T r = Make(0) && Make(2);
            Console.WriteLine(r.X);
            T q = Make(1) || Make(2);
            Console.WriteLine(q.X);
            T w = Make(4) && Make(6);
            Console.WriteLine(w.X);
            T v = Make(0) || Make(5);
            Console.WriteLine(v.X);
            Console.WriteLine(Make(0) ? "t" : "f");
            int n = 2;
            while (Make(n)) n--;
            for (T t = Make(1); t; t = Make(0)) Console.WriteLine("loop");
            if (Make(3) && Make(1)) Console.WriteLine("both");
        }
    }
  `,
  ),
  out(
    'equality-with-null-and-reference-comparison',
    cs`
    using System;
    class V
    {
        public int X;
        public static bool operator ==(V a, V b) { Console.WriteLine("op=="); return (object)a == (object)b; }
        public static bool operator !=(V a, V b) { Console.WriteLine("op!="); return !(a == b); }
    }
    class Program
    {
        static void Main()
        {
            V a = new V(), b = null;
            a.X = 1;
            Console.WriteLine(a == null);
            Console.WriteLine(b != null);
            Console.WriteLine((object)a == null);
            Console.WriteLine(a is null);
            Console.WriteLine(b is null);
        }
    }
  `,
  ),
  out(
    'user-defined-conversions',
    cs`
    using System;
    class Meters
    {
        public double Value;
        public Meters(double v) { Value = v; }
        public static implicit operator double(Meters m) { Console.WriteLine("to double"); return m.Value; }
        public static explicit operator Meters(double v) { Console.WriteLine("from double"); return new Meters(v); }
        public static implicit operator Meters(int v) { Console.WriteLine("from int"); return new Meters(v); }
        public static explicit operator int(Meters m) { Console.WriteLine("to int"); return (int)m.Value; }
        public static implicit operator string(Meters m) { return m.Value + "m"; }
    }
    class Program
    {
        static double Twice(double d) { return d * 2; }
        static string Show(string s) { return "[" + s + "]"; }
        static Meters Pass(Meters m) { return m; }
        static void Main()
        {
            Meters m = 3;
            Meters n = (Meters)2.5;
            double d = m;
            int i = (int)n;
            Console.WriteLine(d + " " + i + " " + Twice(m) + " " + Show(n));
            Meters k = (Meters)i;
            string s = k;
            Console.WriteLine(s);
            Console.WriteLine(Show(Pass(7)));
            double sum = m + 1.5;
            Console.WriteLine(sum);
        }
    }
  `,
  ),
  diag(
    'use-site-errors',
    cs`
    class V
    {
        public static V operator +(V a, V b) { return a; }
        public static explicit operator int(V v) { return 0; }
    }
    class W { }
    class Program
    {
        static void Main()
        {
            V v = new V();
            W w = new W();
            var a = v - v;
            var b = v + w;
            var c = -v;
            int i = v;
            v++;
            bool t = v ? true : false;
            if (w) { }
            var d = v && v;
            string s = (string)v;
        }
    }
  `,
  ),
  diag(
    'declaration-errors',
    cs`
    class V
    {
        static V operator +(V a, V b) { return a; }
        public V operator -(V a, V b) { return a; }
        public static V operator *(int a, int b) { return null; }
        public static bool operator ==(V a, V b) { return true; }
        public static bool operator <(V a, V b) { return true; }
        public static bool operator true(V a) { return true; }
        public static int operator ++(V a) { return 0; }
        public static void operator ~(V a) { }
        public static implicit operator V(V v) { return v; }
        public static implicit operator int(V v) { return 0; }
        public static explicit operator int(V v) { return 0; }
        public static V operator +(V a) { return a; }
        public static V operator +(V a, V b, V c) { return a; }
    }
    class Program { static void Main() { } }
  `,
  ),
  diag(
    'equality-without-equals-and-hash-code',
    cs`
    class V
    {
        public static bool operator ==(V a, V b) { return true; }
        public static bool operator !=(V a, V b) { return false; }
    }
    class Program { static void Main() { } }
  `,
  ),
  diag(
    'short-circuit-requirements',
    cs`
    class A
    {
        public static A operator &(A a, A b) { return a; }
    }
    class B
    {
        public static int operator &(B a, B b) { return 0; }
        public static bool operator true(B b) { return true; }
        public static bool operator false(B b) { return false; }
    }
    class Program
    {
        static void Main()
        {
            A a = new A();
            B b = new B();
            var x = a && a;
            var y = b && b;
        }
    }
  `,
  ),
  diag(
    'ambiguous-and-missing-conversions',
    cs`
    class A
    {
        public static implicit operator C(A a) { return null; }
    }
    class C
    {
        public static implicit operator C(A a) { return null; }
        public static explicit operator C(string s) { return null; }
    }
    class Program
    {
        static void Main()
        {
            A a = new A();
            C c = a;
            C d = "text";
            C e = (C)5;
        }
    }
  `,
  ),
];

export const fixtures = [...feature('member-indexers', indexers), ...feature('member-operators', operators)];
