/**
 * Differential fixtures for SF-A02-T60 and SF-A02-T62: interpolated strings (holes, alignment and format, verbatim
 * forms, nesting; CS0150, CS8094, CS1503, CS8917, constant interpolated strings) and C# 6 member bodies (expression
 * bodies, auto-property initializers in declaration order; CS8050, CS8051, CS8053, CS8057, CS0200, CS0236).
 */
import { cs, out, diag, feature } from './kit.js';

const interpolation = feature('interpolation-binding', [
  out(
    'holes-alignment-format-and-nesting',
    cs`
      using System;
      class Program
      {
          static void Main()
          {
              int x = 5; string s = "hi"; double d = 1.5; object o = null;
              Console.WriteLine($"x={x} s={s} d={d}");
              Console.WriteLine($"{x,5}|{x,-5}|{d:F2}|{x:D3}|{x,6:D3}|");
              Console.WriteLine($"{{literal}} {x + 1} {(x > 3 ? "big" : "small")}");
              Console.WriteLine($@"a\b {s}" + @$"c\d {x}");
              Console.WriteLine($"" + $"[{o}]" + $"{null}" + $"{x}{x}{x}" + $"{true} {1.0} {s.Length}");
              Console.WriteLine($"{$"{x}!"} {s + $"{d}"}");
              const string greeting = "hello";
              const string constant = $"{greeting}, {"world"}";
              Console.WriteLine(constant);
          }
      }
    `,
  ),
  diag(
    'cs8094-cs1503-cs8917-holes-without-a-value',
    cs`
      class Program
      {
          static void M() { }
          static void Main()
          {
              int x = 5;
              var b = $"{M()}";
              var c = $"{x => x}";
              var d = $"{Main}";
              var f = $"{missing}";
              var h = $"{x, 40000}";
              const string k = $"{x}";
              var j = $"{null,2}";
          }
      }
    `,
  ),
  // The parser accepts any expression as an alignment; the binder reports the ones that are not int constants.
  diag(
    'cs0150-cs0266-cs0029-alignments-that-are-not-int-constants',
    cs`
      class Program
      {
          static void Main()
          {
              int x = 5; int w = 3;
              var a = $"{x,w}";
              var e = $"{x,1.5}";
              var g = $"{x,"s"}";
          }
      }
    `,
  ),
  diag(
    'cs8773-constant-interpolated-string-in-csharp-9',
    cs`
      class Program
      {
          const string A = "a";
          const string B = $"{A}b";
          static void Main() { System.Console.WriteLine(B); }
      }
    `,
    { langVersion: '9' },
  ),
  out(
    'constant-expression-alignments',
    cs`
      using System;
      class Program
      {
          const int Width = 6;
          static void Main()
          {
              const int local = 4;
              int x = 42;
              string s = "ab";
              Console.WriteLine($"[{x,Width}][{x,-Width}][{s,local}][{s,-local}]");
              Console.WriteLine($"[{x,Width + 2}][{x,(short)3}][{x,+5}][{x,-(local)}]");
              Console.WriteLine($"[{x,Width:D4}][{1.5,Width:F2}][{x,0}][{s,1}]");
          }
      }
    `,
  ),
  diag(
    'cs8094-alignment-out-of-range-in-a-program-that-compiles',
    cs`
      using System;
      class Program
      {
          static void Main()
          {
              int x = 1;
              Console.WriteLine($"{x,40000}|{x,-40000}|{x,32767}|{x,-32767}|{x,32768:D2}".Length);
          }
      }
    `,
  ),
  diag(
    'cs0029-formattable-string-and-iformattable-targets',
    cs`
      using System;
      class Program
      {
          static void Take(FormattableString f) { Console.WriteLine(f.Format + f.ArgumentCount + f.GetArgument(0) + f.GetArguments().Length); }
          static void Both(string s) { Console.WriteLine("string"); }
          static void Both(FormattableString f) { Console.WriteLine("formattable"); }
          static void Fmt(IFormattable f) { Console.WriteLine(f.ToString(null, null)); }
          static void Main()
          {
              int x = 1;
              FormattableString f = $"a{x}b{x,3:D2}";
              IFormattable g = $"a{x}";
              Take($"v{x}"); Both($"v{x}"); Fmt($"v{x}");
              var v = $"v{x}"; Both(v);
              object o = $"a{x}"; IComparable c = $"a{x}";
              var cast = (FormattableString)$"a{x}";
              string invariant = FormattableString.Invariant($"a{x}") + f.ToString() + g + o + c + cast;
              FormattableString plain = "plain";
              FormattableString concatenated = $"a" + $"b";
              FormattableString coalesced = $"{x}" ?? null;
              FormattableString fromString = v;
          }
      }
    `,
  ),
]);

const memberBodies = feature('member-bodies', [
  out(
    'initializers-run-in-declaration-order-before-the-constructor',
    cs`
      using System;
      class C
      {
          static int Trace(string s, int v) { Console.WriteLine(s); return v; }
          public int A { get; set; } = Trace("A", 1);
          int f = Trace("f", 2);
          public int R { get; } = Trace("R", 3);
          public static int S { get; } = Trace("S", 4);
          public string N { get; }
          public C() { Console.WriteLine("C ctor"); N = "n"; A = A + 10; }
          public C(int x) : this() { Console.WriteLine("C(int)"); }
          public int Sum => A + f + R + S;
          public string Text() => N + Sum;
          public int P { get => f; set => f = value; }
      }
      class Program
      {
          static void Main()
          {
              var c = new C(1);
              Console.WriteLine(c.Sum + c.N + c.Text());
              c.P = 5;
              Console.WriteLine(c.P);
          }
      }
    `,
  ),
  diag(
    'cs8050-cs8051-cs8053-cs0200-auto-property-rules',
    cs`
      class C
      {
          public int A { get; set; } = 1;
          public int R { get; } = 2;
          public static int S { get; } = 3;
          public int W { set; } = 4;
          public int X { get { return 1; } } = 5;
          public string T { get; } = 6;
          public int I { get; } = other;
          int other = 1;
          public int N { get; }
          public C() { N = 1; R = 5; }
          public void M() { R = 6; N = 2; }
      }
      interface I { int P { get; } = 1; }
      class Program { static void Main() { } }
    `,
  ),
  diag(
    'cs8057-cs0201-cs0029-expression-bodies',
    cs`
      using System;
      class C
      {
          int v = 2;
          public int Twice => v * 2;
          public void V() => 5;
          public int W() => Console.WriteLine();
          public int Both { get { return 1; } } => 2;
      }
      class Program { static void Main() { } }
    `,
  ),
  diag(
    'cs8057-block-and-expression-body-on-every-kind-of-member',
    cs`
      using System;
      class C
      {
          int count;
          int M() { return 1; } => 2;
          void V() { } => Console.WriteLine();
          C() { } => count = 1;
          ~C() { } => count = 2;
          public static C operator +(C a, C b) { return a; } => b;
          public static implicit operator int(C c) { return 1; } => 2;
          int P { get { return 1; } => 2; set { } => count = value; }
          int Q { get => 1; set { count = value; } }
          int this[int i] { get { return i; } => i + 1; }
          int R { get { return 1; } } => 2;
          int this[string s] { get { return 1; } } => 2;
          event EventHandler E { add { } => count = 1; remove { } => count = 2; }
          static void Main()
          {
              int Local() { return 1; } => 2;
              void LocalVoid() { } => Console.WriteLine();
              Func<int> f = () => 1;
              Console.WriteLine(Local() + f());
              LocalVoid();
          }
      }
    `,
  ),
]);

export const fixtures = [...interpolation, ...memberBodies];
