/**
 * Differential fixtures for SF-A02-T72 (C# 9): module initializers, `[SkipLocalsInit]`, covariant returns and lambda
 * discard parameters. Covariant returns need a class hierarchy, which the runtime profile cannot execute: their
 * fixtures compare diagnostics only (tests/compiler-csharp9-rules.test.js checks the bound types).
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('module-initializers', [
    out(
      'run-before-main-in-declaration-order',
      cs`
    using System;
    using System.Runtime.CompilerServices;
    class First
    {
        static First() { Console.WriteLine("First.cctor"); }
        [ModuleInitializer] internal static void Init() { Console.WriteLine("first"); }
    }
    class Second
    {
        [ModuleInitializerAttribute] public static void Init() { Console.WriteLine("second"); }
        public static void NotOne() { Console.WriteLine("never"); }
    }
    class Program
    {
        static Program() { Console.WriteLine("Program.cctor"); }
        static void Main() { Console.WriteLine("main"); }
    }
  `,
    ),
    out(
      'before-top-level-statements',
      cs`
    using System;
    using System.Runtime.CompilerServices;
    Console.WriteLine("main " + Setup.Count);
    static class Setup
    {
        public static int Count;
        [ModuleInitializer] public static void A() { Count++; Console.WriteLine("a"); }
        [ModuleInitializer] public static void B() { Count++; Console.WriteLine("b"); }
    }
  `,
    ),
    diag(
      'declaration-rules',
      cs`
    using System.Runtime.CompilerServices;
    class M
    {
        [ModuleInitializer] static void Private() { }
        [ModuleInitializer] public static int ReturnsValue() => 1;
        [ModuleInitializer] public void Instance() { }
        [ModuleInitializer] public static void Parameter(int x) { }
        [ModuleInitializer] public static void Generic<T>() { }
        [ModuleInitializer] protected static void Protected() { }
        [ModuleInitializer] private protected static void PrivateProtected() { }
        [ModuleInitializer] protected internal static void ProtectedInternal() { }
        [ModuleInitializer] M() { }
        [ModuleInitializer] public static M operator +(M a, M b) => a;
    }
    class G<T> { [ModuleInitializer] public static void Init() { } }
    class O
    {
        class Inner { [ModuleInitializer] public static void Init() { } }
        internal class Visible { [ModuleInitializer] public static void Init() { } }
    }
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'module-initializer-in-csharp-8',
      cs`
    using System.Runtime.CompilerServices;
    class M { [ModuleInitializer] internal static void Init() { } }
    class Program { static void Main() { } }
  `,
      { langVersion: '8' },
    ),
    diag(
      'cs0227-skip-locals-init-needs-unsafe',
      cs`
    using System.Runtime.CompilerServices;
    [SkipLocalsInit] class Q { }
    class Program { [SkipLocalsInit] static void Main() { } }
  `,
    ),
  ]),
  ...feature('covariant-returns', [
    diag(
      'override-return-type-rules',
      cs`
    interface I { object M(); object P { get; } }
    class A
    {
        public virtual A M() => null;
        public virtual object P { get; set; }
        public virtual object Q => null;
        public virtual int V() => 0;
        public virtual A F() => null;
        public virtual object G() => null;
    }
    class B : A
    {
        public override object M() => null;
        public override string P { get; set; }
        public override int Q => 1;
        public override long V() => 0;
        public override string F() => null;
        public override string G() => null;
    }
    class C : I { public string M() => null; public string P => null; }
    class D : I { string I.M() => null; object I.P => null; }
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'calls-have-the-return-type-of-the-override',
      cs`
    class A { public virtual A Clone() => new A(); public virtual object Value => null; }
    class B : A { public override B Clone() => new B(); public override string Value => "b"; }
    class C : B { public override C Clone() => new C(); }
    class Program
    {
        static void Main()
        {
            B b = new B().Clone();
            C c = new C().Clone();
            A a = c;
            C wrong = a.Clone();
            B alsoWrong = ((A)b).Clone();
            int length = b.Value.Length + c.Value.Length;
            string text = a.Value;
        }
    }
  `,
    ),
    diag(
      'covariant-returns-in-csharp-8',
      cs`
    class A { public virtual A Clone() => new A(); public virtual object P => null; }
    class B : A { public override B Clone() => new B(); public override string P => null; }
    class Program { static void Main() { } }
  `,
      { langVersion: '8' },
    ),
  ]),
  ...feature('lambda-discards', [
    out(
      'several-underscore-parameters',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            Func<int, int, int> five = (_, _) => 5;
            Func<int, int, int, int> last = (_, _, c) => c;
            Func<int, int> identity = _ => _;
            Func<int, int, int> typed = (int _, int _) => 7;
            Func<int, int, int> anonymous = delegate (int _, int _) { return 9; };
            Console.WriteLine(five(1, 2) + last(1, 2, 3) + identity(4) + typed(0, 0) + anonymous(0, 0));
        }
    }
  `,
    ),
    diag(
      'cs0103-a-discard-is-not-a-name',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            Func<int, int, int> g = (_, _) => _;
            Func<int, int> h = _ => _;
        }
    }
  `,
    ),
    diag(
      'lambda-discards-in-csharp-8',
      cs`
    using System;
    class Program
    {
        static void Main() { Func<int, int, int> g = (_, _) => 5; }
    }
  `,
      { langVersion: '8' },
    ),
  ]),
];
