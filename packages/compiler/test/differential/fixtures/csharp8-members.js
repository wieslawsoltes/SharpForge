/**
 * Differential fixtures for the C# 8 member and operator rules of SF-A02-E08: null-coalescing assignment, readonly
 * members, what an interface may declare, and `??` over an unconstrained type parameter.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('coalesce-assignment', [
    out(
      'assigns-only-when-the-target-is-null',
      cs`
    using System;
    class Program
    {
        static int calls;
        static string Make() { calls++; return "made"; }
        string F;
        string Q { get; set; }
        static string S;
        static void Main()
        {
            string s = null; s ??= Make(); s ??= Make();
            int[] a = null; (a ??= new int[2])[0] = 7;
            Console.WriteLine(s + " " + calls + " " + a[0]);
            var p = new Program(); p.F ??= "f"; p.Q ??= "q"; S ??= "s";
            Console.WriteLine(p.F + p.Q + S);
            string[] arr = new string[1]; arr[0] ??= "e"; arr[0] ??= "x";
            Console.WriteLine(arr[0]);
            string t = s ??= "unused";
            Console.WriteLine(t);
        }
    }
  `,
    ),
    diag(
      'operand-types',
      cs`
    using System;
    class Program
    {
        static string M() { return null; }
        static void Main()
        {
            int i = 0; i ??= 1;
            string s = null; s ??= 1;
            const string c = null; c ??= "x";
            int? n = null; n ??= "s";
            M() ??= "x";
            object o = null; o ??= default;
            string r = s ??= null;
            Console.WriteLine(i + r + o + n);
        }
    }
  `,
    ),
    diag('coalesce-assignment-in-7-3', cs`class Program { static void Main() { string s = null; s ??= "x"; } }`, { langVersion: '7.3' }),
  ]),
  ...feature('readonly-members', [
    diag(
      'declaration-and-body-rules',
      cs`
    using System;
    struct S
    {
        public int X;
        int y;
        public readonly int Double() => X * 2;
        public readonly void Set() { X = 1; y = 2; }
        public void Mutate() { X++; }
        public readonly void Call() { Mutate(); Console.WriteLine(Double() + y); }
        public readonly int P { get { return X; } set { X = value; } }
        public int Q { readonly get { return X; } set { X = value; } }
        public readonly int Auto { get; set; }
        public readonly int AutoGet { get; }
        public static readonly void St() { }
        public readonly S(int x) { X = x; y = 0; Auto = 0; AutoGet = 0; }
        public readonly event Action E { add { X = 1; } remove { } }
        public int R { readonly get { return X; } readonly set { } }
        public readonly int this[int i] { get { return X + i; } }
        public readonly override string ToString() { X = 2; return "S"; }
    }
    class C { public readonly void M() { } public readonly int P => 1; }
    interface I { readonly void M(); }
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'readonly-members-in-7-3',
      cs`
    struct S
    {
        public int X;
        public readonly int Double() => X * 2;
        public int P { readonly get { return X; } set { X = value; } }
    }
    class Program { static void Main() { } }
  `,
      { langVersion: '7.3' },
    ),
  ]),
  ...feature('interface-members', [
    diag(
      'what-an-interface-may-declare',
      cs`
    using System;
    interface I
    {
        int V { get; }
        int Twice() { return V * 2; }
        string Name() => "I";
        static int S() => 7;
        private int Hidden() => 1;
        public int Visible() => Hidden() + 1;
        protected void Prot() { }
        static int Count;
        const int K = 3;
        int Field;
        sealed void Sealed() { }
        abstract void Abs();
        virtual void Virt() { }
        class Nested { }
        static I() { Count = 1; }
        I() { }
        int this[int i] { get { return i; } }
        event Action E { add { } remove { } }
    }
    class A : I { public int V => 4; public void Abs() { } }
    class Program
    {
        static void Main()
        {
            I a = new A();
            Console.WriteLine(a.Twice() + " " + a.Name() + " " + I.S() + " " + I.K + " " + a.Visible());
            new A().Twice();
            a.Hidden();
        }
    }
  `,
    ),
    diag(
      'default-interface-members-in-7-3',
      cs`interface I { void M() { } int P { get { return 1; } } static void S() { } public void Q(); }
class Program { static void Main() { } }`,
      { langVersion: '7.3' },
    ),
  ]),
  ...feature('coalesce', [
    diag(
      'type-parameter-operands',
      cs`
    class Program
    {
        static T M<T>(T a, T b) { return a ?? b; }
        static T N<T>(T a, T b) where T : struct { return a ?? b; }
        static T O<T>(T a, T b) where T : class { return a ?? b; }
        static void Main() { }
    }
  `,
    ),
    diag(
      'unconstrained-type-parameter-in-7-3',
      cs`
    class Program
    {
        static T M<T>(T a, T b) { return a ?? b; }
        static T O<T>(T a, T b) where T : class { return a ?? b; }
        static void Main() { }
    }
  `,
      { langVersion: '7.3' },
    ),
  ]),
];
