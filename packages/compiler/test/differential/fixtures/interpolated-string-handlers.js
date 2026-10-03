/**
 * Interpolated string handlers (SF-A02-T75, C# 10): the conversion of an interpolated string to a type marked
 * `[InterpolatedStringHandler]` is the handler pattern - a constructor call and one `AppendLiteral` /
 * `AppendFormatted` call per part.
 */
import { cs, out, diag, feature } from './kit.js';

const logHandler = `
[InterpolatedStringHandler]
class LogHandler {
  string text;
  public LogHandler(int literalLength, int formattedCount) { text = "[" + literalLength + "," + formattedCount + "]"; }
  public void AppendLiteral(string s) { text = text + "L(" + s + ")"; }
  public void AppendFormatted(int value) { text = text + "I(" + value + ")"; }
  public void AppendFormatted(string value) { text = text + "S(" + value + ")"; }
  public void AppendFormatted(int value, int alignment = 0, string format = null) {
    text = text + "I(" + value + "," + alignment + "," + (format ?? "null") + ")";
  }
  public void AppendFormatted<T>(T value) { text = text + "T(" + value + ")"; }
  public string Result() { return text; }
}`;

const list = [
  out(
    'handler-pattern',
    cs`
    using System;
    using System.Runtime.CompilerServices;
    ${logHandler}
    class Program {
      static void Log(LogHandler handler) { Console.WriteLine(handler.Result()); }
      static void Both(string text) { Console.WriteLine("string " + text); }
      static void Both(LogHandler handler) { Console.WriteLine("handler " + handler.Result()); }
      static LogHandler Make(int n) { return $"made {n}"; }
      static void Main() {
        int n = 3;
        string s = "x";
        Log($"a {n} b {s} c");
        Log($"{n}{s}");
        Log($"no holes");
        Log($"");
        Log($"aligned {n,5} formatted {n:X2} both {n,-4:D3}");
        Log($"generic {1.5} {true}");
        Log($"braces {{{n}}}");
        LogHandler local = $"local {n}";
        Console.WriteLine(local.Result());
        Console.WriteLine(Make(7).Result());
        Console.WriteLine(((LogHandler)$"cast {s}").Result());
        Both($"picked {n}");
        Both($"constant");
        Both("plain");
        const string name = "c";
        Both($"constant {name}");
      }
    }
    `,
  ),
  out(
    'bool-appends-and-enabled-flag',
    cs`
    using System;
    using System.Runtime.CompilerServices;
    [InterpolatedStringHandler]
    class Limited {
      string text = "";
      int budget;
      public Limited(int literalLength, int formattedCount) { budget = 2; }
      public bool AppendLiteral(string s) { text = text + s; budget = budget - 1; return budget > 0; }
      public bool AppendFormatted(int value) { text = text + "<" + value + ">"; budget = budget - 1; return budget > 0; }
      public string Result() { return text; }
    }
    [InterpolatedStringHandler]
    class Guarded {
      string text = "";
      public Guarded(int literalLength, int formattedCount, out bool enabled) { enabled = Program.Enabled; }
      public void AppendLiteral(string s) { text = text + s; }
      public void AppendFormatted(int value) { text = text + value; }
      public string Result() { return text == "" ? "(nothing)" : text; }
    }
    [InterpolatedStringHandler]
    class GuardedAndLimited {
      string text = "";
      public GuardedAndLimited(int literalLength, int formattedCount, out bool enabled) { enabled = formattedCount > 0; }
      public GuardedAndLimited(int literalLength, int formattedCount) { text = "wrong constructor"; }
      public bool AppendLiteral(string s) { text = text + s; return true; }
      public bool AppendFormatted(int value) { text = text + value; return value < 10; }
      public string Result() { return text == "" ? "(nothing)" : text; }
    }
    class Program {
      public static bool Enabled;
      static int calls;
      static int Next() { calls = calls + 1; return calls; }
      static void Main() {
        Limited limited = $"a{Next()}b{Next()}c";
        Console.WriteLine(limited.Result() + " calls=" + calls);
        Guarded off = $"x{Next()}y";
        Console.WriteLine(off.Result() + " calls=" + calls);
        Enabled = true;
        Guarded on = $"x{Next()}y";
        Console.WriteLine(on.Result() + " calls=" + calls);
        GuardedAndLimited none = $"only text";
        Console.WriteLine(none.Result());
        GuardedAndLimited some = $"p{5}q{50}r{Next()}";
        Console.WriteLine(some.Result() + " calls=" + calls);
      }
    }
    `,
  ),
  diag(
    'pattern-errors',
    cs`
    using System.Runtime.CompilerServices;
    [InterpolatedStringHandler]
    class NoAppend { public NoAppend(int literalLength, int formattedCount) { } }
    [InterpolatedStringHandler]
    class NoConstructor { public void AppendLiteral(string s) { } public void AppendFormatted(int v) { } }
    [InterpolatedStringHandler]
    class BadReturn {
      public BadReturn(int literalLength, int formattedCount) { }
      public int AppendLiteral(string s) { return 0; }
      public void AppendFormatted(int v) { }
    }
    [InterpolatedStringHandler]
    class Mixed {
      public Mixed(int literalLength, int formattedCount) { }
      public void AppendLiteral(string s) { }
      public bool AppendFormatted(int v) { return true; }
    }
    [InterpolatedStringHandler]
    class IntOnly {
      public IntOnly(int literalLength, int formattedCount) { }
      public void AppendLiteral(string s) { }
      public void AppendFormatted(int v) { }
    }
    class NotAHandler { public NotAHandler(int literalLength, int formattedCount) { } }
    class Program {
      static void Main() {
        int n = 1;
        NoAppend a = $"text {n}";
        NoConstructor b = $"text {n}";
        BadReturn c = $"text {n}";
        Mixed d = $"text {n} more";
        IntOnly e = $"text {"s"}";
        IntOnly f = $"text {n,5}";
        IntOnly g = $"text {n:X}";
        NotAHandler h = $"text {n}";
        IntOnly i = "plain";
      }
    }
    `,
  ),
  diag(
    'handlers-in-9',
    cs`
    using System.Runtime.CompilerServices;
    ${logHandler}
    class Program {
      static void Log(LogHandler handler) { }
      static void Main() {
        int n = 1;
        Log($"a {n}");
        LogHandler h = $"b";
      }
    }
    `,
    { langVersion: '9' },
  ),
  // Runs on .NET. Here a handler declared as a struct is refused with the other structs (SF2200).
  out(
    'struct-handler',
    cs`
    using System;
    using System.Runtime.CompilerServices;
    [InterpolatedStringHandler]
    struct Counter {
      public int Parts;
      public Counter(int literalLength, int formattedCount) { Parts = 0; }
      public void AppendLiteral(string s) { Parts = Parts + 1; }
      public void AppendFormatted<T>(T value) { Parts = Parts + 10; }
    }
    class Program {
      static void Main() {
        Counter c = $"a {1} b {"two"}";
        Console.WriteLine(c.Parts);
      }
    }
    `,
  ),
];

export const fixtures = feature('interpolated-string-handlers', list);
