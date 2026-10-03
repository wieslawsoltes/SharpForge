/** Differential fixtures: arithmetic, operators, strings, interpolation, constants and conversions. */
import {cs,out,diag,feature} from './kit.js';

export const fixtures=[
...feature('arithmetic',[
  out('int-ops',cs`
    using System;
    Console.WriteLine(1 + 2 * 3);
    Console.WriteLine((1 + 2) * 3);
    Console.WriteLine(7 / 2);
    Console.WriteLine(-7 / 2);
    Console.WriteLine(7 % 3);
    Console.WriteLine(-7 % 3);
    Console.WriteLine(-(3 - 5));
  `),
  out('int-overflow-wraps',cs`
    using System;
    int x = int.MaxValue;
    x = x + 1;
    Console.WriteLine(x);
    int y = int.MinValue;
    y--;
    Console.WriteLine(y);
  `),
  out('double-ops',cs`
    using System;
    Console.WriteLine(1.0 / 2);
    Console.WriteLine(10 / 4);
    Console.WriteLine(10 / 4.0);
    Console.WriteLine(1.0 / 3);
    Console.WriteLine(0.1 + 0.2);
    Console.WriteLine(2.5 * 2);
    Console.WriteLine(1e3);
  `),
  out('compound-assignment',cs`
    using System;
    int a = 10;
    a += 5; Console.WriteLine(a);
    a -= 3; Console.WriteLine(a);
    a *= 2; Console.WriteLine(a);
    a /= 5; Console.WriteLine(a);
    a %= 3; Console.WriteLine(a);
    a++; Console.WriteLine(a);
    a--; Console.WriteLine(a);
  `),
  out('increment-order',cs`
    using System;
    int i = 5;
    int a = i++ + ++i;
    Console.WriteLine(a);
    Console.WriteLine(i);
    int b = i-- - --i;
    Console.WriteLine(b);
    Console.WriteLine(i);
  `),
  out('bitwise',cs`
    using System;
    int a = 12, b = 10;
    Console.WriteLine(a & b);
    Console.WriteLine(a | b);
    Console.WriteLine(a ^ b);
    Console.WriteLine(~a);
    Console.WriteLine(a << 2);
    Console.WriteLine(a >> 1);
    Console.WriteLine(-16 >> 2);
  `),
  out('long-factorial',cs`
    using System;
    long f = 1;
    for (int i = 2; i <= 20; i++) f *= i;
    Console.WriteLine(f);
    long big = 3000000000L;
    Console.WriteLine(big + 1);
  `),
  out('divide-by-zero',cs`
    using System;
    int zero = 0;
    try { Console.WriteLine(10 / zero); }
    catch (DivideByZeroException) { Console.WriteLine("div by zero"); }
    Console.WriteLine(1.0 / zero);
  `),
  out('checked-overflow',cs`
    using System;
    int x = int.MaxValue;
    try { int y = checked(x + 1); Console.WriteLine(y); }
    catch (OverflowException) { Console.WriteLine("overflow"); }
    Console.WriteLine(unchecked(x + 1));
  `),
  out('math-functions',cs`
    using System;
    Console.WriteLine(Math.Abs(-5));
    Console.WriteLine(Math.Max(3, 7));
    Console.WriteLine(Math.Min(3, 7));
    Console.WriteLine(Math.Floor(2.7));
    Console.WriteLine(Math.Ceiling(2.1));
    Console.WriteLine(Math.Round(2.5));
    Console.WriteLine(Math.Round(3.5));
    Console.WriteLine(Math.Sqrt(16));
    Console.WriteLine(Math.Pow(2, 10));
  `),
  diag('cs0020-constant-division-by-zero',cs`
    using System;
    int x = 1 / 0;
    Console.WriteLine(x);
  `),
  diag('cs0220-constant-overflow',cs`
    using System;
    int x = int.MaxValue + 1;
    Console.WriteLine(x);
  `),
]),
...feature('operators',[
  out('short-circuit',cs`
    using System;
    bool T(string s) { Console.WriteLine(s); return true; }
    bool F(string s) { Console.WriteLine(s); return false; }
    Console.WriteLine(F("a") && T("b"));
    Console.WriteLine(T("c") || F("d"));
    Console.WriteLine(F("e") & T("f"));
    Console.WriteLine(T("g") | F("h"));
  `),
  out('comparison-and-logic',cs`
    using System;
    int a = 3, b = 4;
    Console.WriteLine(a < b);
    Console.WriteLine(a >= b);
    Console.WriteLine(a == b || a != b);
    Console.WriteLine(!(a < b) ^ true);
    Console.WriteLine(a < b ? "less" : "not less");
  `),
  out('null-coalescing',cs`
    using System;
    string s = null;
    Console.WriteLine(s ?? "fallback");
    s ??= "assigned";
    Console.WriteLine(s);
    s ??= "ignored";
    Console.WriteLine(s);
  `),
  out('ternary-chain',cs`
    using System;
    for (int i = -1; i <= 1; i++)
        Console.WriteLine(i < 0 ? "negative" : i == 0 ? "zero" : "positive");
  `),
  diag('cs0019-int-plus-bool',cs`
    using System;
    int x = 1 + true;
    Console.WriteLine(x);
  `),
  diag('cs0019-string-minus',cs`
    using System;
    string s = "a" - "b";
    Console.WriteLine(s);
  `),
  diag('cs0019-and-on-ints',cs`
    using System;
    int a = 1, b = 2;
    if (a && b) Console.WriteLine("x");
  `),
  diag('cs0023-not-on-int',cs`
    using System;
    int a = 5;
    Console.WriteLine(!a);
  `),
  diag('cs0023-minus-on-string',cs`
    using System;
    string s = "a";
    Console.WriteLine(-s);
  `),
  diag('cs0173-ternary-mismatch',cs`
    using System;
    bool b = true;
    var x = b ? 1 : "one";
    Console.WriteLine(x);
  `),
  diag('cs0131-assign-to-expression',cs`
    using System;
    int a = 1;
    a + 1 = 3;
    Console.WriteLine(a);
  `),
]),
...feature('strings',[
  out('concat-and-length',cs`
    using System;
    string a = "Hello", b = "World";
    string c = a + ", " + b + "!";
    Console.WriteLine(c);
    Console.WriteLine(c.Length);
    Console.WriteLine("n=" + 5 + 1);
    Console.WriteLine(5 + 1 + "=n");
    Console.WriteLine("b=" + true + " d=" + 1.5);
  `),
  out('search-and-slice',cs`
    using System;
    string s = "The quick brown fox";
    Console.WriteLine(s.Substring(4, 5));
    Console.WriteLine(s.Substring(10));
    Console.WriteLine(s.IndexOf("quick"));
    Console.WriteLine(s.IndexOf("slow"));
    Console.WriteLine(s.Contains("brown"));
    Console.WriteLine(s.StartsWith("The"));
    Console.WriteLine(s.EndsWith("dog"));
  `),
  out('transform',cs`
    using System;
    string s = "  Mixed Case  ";
    Console.WriteLine("[" + s.Trim() + "]");
    Console.WriteLine(s.ToUpper());
    Console.WriteLine(s.ToLower());
    Console.WriteLine(s.Trim().Replace("Mixed", "Upper"));
    Console.WriteLine("7".PadLeft(3, '0'));
    Console.WriteLine("ab".PadRight(4) + "|");
  `),
  out('split-and-join',cs`
    using System;
    string[] parts = "a,b,c".Split(',');
    Console.WriteLine(parts.Length);
    Console.WriteLine(string.Join("-", parts));
    Console.WriteLine(string.Join(" ", "one two  three".Split(' ')));
  `),
  out('equality-and-compare',cs`
    using System;
    string a = "abc";
    string b = "ab" + "c";
    Console.WriteLine(a == b);
    Console.WriteLine(a.Equals(b));
    Console.WriteLine(a != "ABC");
    Console.WriteLine(string.Compare("a", "b") < 0);
    Console.WriteLine(string.IsNullOrEmpty(""));
    Console.WriteLine(string.IsNullOrEmpty(a));
  `),
  out('chars',cs`
    using System;
    string s = "hello";
    char c = s[1];
    Console.WriteLine(c);
    Console.WriteLine((int)c);
    Console.WriteLine((char)(c + 1));
    Console.WriteLine(char.IsDigit('7'));
    Console.WriteLine(char.ToUpper(c));
    int vowels = 0;
    foreach (char ch in s) if (ch == 'e' || ch == 'o') vowels++;
    Console.WriteLine(vowels);
  `),
  out('escapes-and-verbatim',cs`
    using System;
    Console.WriteLine("tab\there");
    Console.WriteLine("quote\"inside");
    Console.WriteLine("back\\slash");
    Console.WriteLine(@"C:\temp\file");
    Console.WriteLine(@"say ""hi""");
    Console.Write("no newline");
    Console.Write("\n");
  `),
  out('string-builder',cs`
    using System;
    using System.Text;
    var sb = new StringBuilder();
    for (int i = 0; i < 3; i++) sb.Append(i).Append(',');
    sb.AppendLine("end");
    sb.Insert(0, "start:");
    Console.Write(sb.ToString());
    Console.WriteLine(sb.Length);
  `),
  out('format-and-tostring',cs`
    using System;
    Console.WriteLine(string.Format("{0} + {1} = {2}", 1, 2, 3));
    Console.WriteLine("{0}-{1}", "a", "b");
    Console.WriteLine(42.ToString());
    Console.WriteLine(3.14159.ToString("F2"));
    Console.WriteLine(255.ToString("X"));
    Console.WriteLine(true.ToString());
  `),
  out('null-concat',cs`
    using System;
    string s = null;
    Console.WriteLine("[" + s + "]");
    object o = null;
    Console.WriteLine("[" + o + "]");
    Console.WriteLine(s == null);
  `),
  diag('cs1061-misspelled-length',cs`
    using System;
    string s = "abc";
    Console.WriteLine(s.Lenght);
  `),
  diag('cs0200-assign-length',cs`
    using System;
    string s = "abc";
    s.Length = 5;
    Console.WriteLine(s);
  `),
  diag('cs0200-assign-char-index',cs`
    using System;
    string s = "abc";
    s[0] = 'x';
    Console.WriteLine(s);
  `),
  diag('cs1012-too-many-chars',cs`
    using System;
    char c = 'ab';
    Console.WriteLine(c);
  `),
]),
...feature('interpolation',[
  out('basic',cs`
    using System;
    string name = "World";
    int n = 3;
    Console.WriteLine($"Hello, {name}!");
    Console.WriteLine($"{n} + {n} = {n + n}");
    Console.WriteLine($"{name.Length} chars, upper {name.ToUpper()}");
    Console.WriteLine($"{true} {1.5} {null}");
  `),
  out('format-and-alignment',cs`
    using System;
    double pi = 3.14159;
    int n = 7;
    Console.WriteLine($"{pi:F2}");
    Console.WriteLine($"{n:D3}");
    Console.WriteLine($"[{n,5}]");
    Console.WriteLine($"[{n,-5}]");
    Console.WriteLine($"[{pi,8:F1}]");
    Console.WriteLine($"{255:X2}");
  `),
  out('braces-and-conditional',cs`
    using System;
    int n = 2;
    Console.WriteLine($"{{literal}} {n}");
    Console.WriteLine($"{(n > 1 ? "many" : "one")}");
    Console.WriteLine($@"path\{n}\end");
  `),
  out('nested',cs`
    using System;
    string[] names = { "a", "b" };
    Console.WriteLine($"outer {$"inner {names[0]}"} {string.Join("+", names)}");
  `),
  out('raw-string-literal',cs`
    using System;
    int n = 5;
    string s = """
        line "one"
        line two
        """;
    Console.WriteLine(s);
    Console.WriteLine($"""value {n} "quoted" """);
  `),
  diag('cs0103-in-hole',cs`
    using System;
    Console.WriteLine($"value {missing}");
  `),
  diag('cs1061-in-hole',cs`
    using System;
    int n = 1;
    Console.WriteLine($"value {n.Count}");
  `),
]),
...feature('constants',[
  out('folding',cs`
    using System;
    const int A = 6;
    const int B = A * 7;
    const string S = "x" + "y";
    const double D = 1.5 * 2;
    const bool T = A < B;
    Console.WriteLine(B);
    Console.WriteLine(S);
    Console.WriteLine(D);
    Console.WriteLine(T);
  `),
  out('const-fields',cs`
    using System;
    Console.WriteLine(Limits.Max);
    Console.WriteLine(Limits.Name + Limits.Max);
    Console.WriteLine(Limits.Double);
    class Limits
    {
        public const int Max = 100;
        public const string Name = "max=";
        public const int Double = Max * 2;
    }
  `),
  out('const-in-switch',cs`
    using System;
    const int One = 1;
    const int Two = One + 1;
    for (int i = 1; i <= 3; i++)
    {
        switch (i)
        {
            case One: Console.WriteLine("one"); break;
            case Two: Console.WriteLine("two"); break;
            default: Console.WriteLine("other"); break;
        }
    }
  `),
  out('static-readonly',cs`
    using System;
    Console.WriteLine(Config.Size);
    Console.WriteLine(new Config().Tag);
    class Config
    {
        public static readonly int Size = 4 * 4;
        public readonly string Tag;
        public Config() { Tag = "t" + Size; }
    }
  `),
  diag('cs0131-assign-const',cs`
    using System;
    const int A = 1;
    A = 2;
    Console.WriteLine(A);
  `),
  diag('cs0133-non-constant-initializer',cs`
    using System;
    int y = 3;
    const int A = y;
    Console.WriteLine(A);
  `),
  diag('cs0145-const-without-value',cs`
    using System;
    const int A;
    Console.WriteLine(1);
  `),
  diag('cs0110-circular-constant',cs`
    using System;
    class C
    {
        const int A = B + 1;
        const int B = A + 1;
        static void Main() { Console.WriteLine(A); }
    }
  `),
  diag('cs0191-assign-readonly',cs`
    using System;
    class C
    {
        readonly int x = 1;
        void Set() { x = 2; }
        static void Main() { new C().Set(); Console.WriteLine(1); }
    }
  `),
]),
...feature('conversions',[
  out('numeric-implicit-explicit',cs`
    using System;
    int i = 7;
    double d = i;
    long l = i;
    Console.WriteLine(d / 2);
    Console.WriteLine(l * 1000000000);
    Console.WriteLine((int)3.99);
    Console.WriteLine((int)-3.99);
    Console.WriteLine((double)i / 2);
    int big = 300;
    Console.WriteLine((byte)big);
  `),
  out('char-conversions',cs`
    using System;
    char c = 'A';
    int code = c;
    Console.WriteLine(code);
    Console.WriteLine((char)(code + 2));
    Console.WriteLine(c + 1);
    Console.WriteLine('a' + "b");
  `),
  out('boxing-unboxing',cs`
    using System;
    object o = 42;
    int i = (int)o;
    Console.WriteLine(i + 1);
    Console.WriteLine(o is int);
    Console.WriteLine(o is string);
    object s = "text";
    Console.WriteLine(((string)s).Length);
    try { string bad = (string)o; Console.WriteLine(bad); }
    catch (InvalidCastException) { Console.WriteLine("invalid cast"); }
  `),
  out('parse-and-convert',cs`
    using System;
    Console.WriteLine(int.Parse("41") + 1);
    Console.WriteLine(double.Parse("1.5") * 2);
    Console.WriteLine(Convert.ToInt32("7") * 6);
    Console.WriteLine(Convert.ToString(12) + "!");
    Console.WriteLine(int.TryParse("x", out int bad));
    Console.WriteLine(bad);
    Console.WriteLine(int.TryParse("12", out var good) ? good : -1);
    try { int.Parse("oops"); } catch (FormatException) { Console.WriteLine("format"); }
  `),
  out('as-and-is',cs`
    using System;
    object o = "hello";
    string s = o as string;
    Console.WriteLine(s.Length);
    object n = 5;
    string t = n as string;
    Console.WriteLine(t == null);
    if (n is int k) Console.WriteLine(k * 2);
  `),
  diag('cs0029-string-to-int',cs`
    using System;
    int x = "a";
    Console.WriteLine(x);
  `),
  diag('cs0029-int-to-string',cs`
    using System;
    string s = 5;
    Console.WriteLine(s);
  `),
  diag('cs0029-int-to-bool',cs`
    using System;
    int x = 1;
    if (x) Console.WriteLine("yes");
  `),
  diag('cs0266-double-to-int',cs`
    using System;
    double d = 1.5;
    int x = d;
    Console.WriteLine(x);
  `),
  diag('cs0266-long-to-int',cs`
    using System;
    long l = 5;
    int x = l;
    Console.WriteLine(x);
  `),
  diag('cs0030-string-cast-to-int',cs`
    using System;
    string s = "5";
    int x = (int)s;
    Console.WriteLine(x);
  `),
  diag('cs0031-constant-out-of-range',cs`
    using System;
    byte b = 300;
    Console.WriteLine(b);
  `),
  diag('cs0664-double-literal-to-float',cs`
    using System;
    float f = 1.5;
    Console.WriteLine(f);
  `),
  diag('cs0029-return-type',cs`
    using System;
    class C
    {
        static int F() { return "no"; }
        static void Main() { Console.WriteLine(F()); }
    }
  `),
]),
];
