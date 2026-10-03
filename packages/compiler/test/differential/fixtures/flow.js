/** Differential fixtures: control flow, loops, switch, foreach, flow analysis, exceptions, using/dispose, syntax. */
import {cs,out,diag,feature} from './kit.js';

export const fixtures=[
...feature('control-flow',[
  out('if-else-chain',cs`
    using System;
    int[] values = { -5, 0, 7, 100 };
    foreach (int v in values)
    {
        if (v < 0) Console.WriteLine("negative");
        else if (v == 0) Console.WriteLine("zero");
        else if (v < 10) Console.WriteLine("small");
        else Console.WriteLine("large");
    }
  `),
  out('nested-blocks',cs`
    using System;
    int x = 4;
    if (x > 0)
    {
        if (x % 2 == 0) { Console.WriteLine("positive even"); }
        else { Console.WriteLine("positive odd"); }
    }
    { int y = x * 2; Console.WriteLine(y); }
    { int y = x * 3; Console.WriteLine(y); }
  `),
  out('goto-label',cs`
    using System;
    int i = 0;
    again:
    Console.WriteLine(i);
    i++;
    if (i < 3) goto again;
    Console.WriteLine("done");
  `),
  out('main-with-return-code',cs`
    using System;
    class Program
    {
        static int Main(string[] args)
        {
            Console.WriteLine(args.Length);
            if (args.Length > 0) return 1;
            Console.WriteLine("no args");
            return 0;
        }
    }
  `),
  diag('cs0139-break-outside-loop',cs`
    using System;
    Console.WriteLine(1);
    break;
  `),
  diag('cs0139-continue-outside-loop',cs`
    using System;
    class C
    {
        static void Main() { if (true) continue; }
    }
  `),
  diag('cs0159-no-such-label',cs`
    using System;
    Console.WriteLine(1);
    goto missing;
  `),
  diag('cs0642-empty-statement',cs`
    using System;
    int x = 1;
    if (x == 1) ;
    Console.WriteLine(x);
  `),
  diag('cs0164-unreferenced-label',cs`
    using System;
    unused:
    Console.WriteLine(1);
  `),
]),
...feature('loops',[
  out('for-sum',cs`
    using System;
    int sum = 0;
    for (int i = 1; i <= 10; i++) sum += i;
    Console.WriteLine(sum);
    for (int i = 10; i > 0; i -= 3) Console.Write(i + " ");
    Console.WriteLine();
  `),
  out('nested-loops',cs`
    using System;
    for (int i = 1; i <= 3; i++)
    {
        string row = "";
        for (int j = 1; j <= 3; j++) row += (i * j) + " ";
        Console.WriteLine(row.Trim());
    }
  `),
  out('while-and-do',cs`
    using System;
    int n = 3;
    while (n > 0) { Console.WriteLine(n); n--; }
    do { Console.WriteLine("once"); } while (n > 0);
    int k = 27, steps = 0;
    while (k != 1) { k = k % 2 == 0 ? k / 2 : 3 * k + 1; steps++; }
    Console.WriteLine(steps);
  `),
  out('break-continue',cs`
    using System;
    for (int i = 0; i < 10; i++)
    {
        if (i % 2 == 0) continue;
        if (i > 7) break;
        Console.WriteLine(i);
    }
    int j = 0;
    while (true) { if (++j == 4) break; }
    Console.WriteLine(j);
  `),
  out('multiple-variables',cs`
    using System;
    for (int i = 0, j = 10; i < j; i += 3, j -= 3) Console.WriteLine(i + ":" + j);
    int k = 0;
    for (;;) { if (k++ >= 2) break; }
    Console.WriteLine(k);
  `),
  out('fizzbuzz',cs`
    using System;
    for (int i = 1; i <= 15; i++)
    {
        if (i % 15 == 0) Console.WriteLine("FizzBuzz");
        else if (i % 3 == 0) Console.WriteLine("Fizz");
        else if (i % 5 == 0) Console.WriteLine("Buzz");
        else Console.WriteLine(i);
    }
  `),
  out('primes',cs`
    using System;
    int count = 0;
    for (int n = 2; n < 50; n++)
    {
        bool prime = true;
        for (int d = 2; d * d <= n; d++) if (n % d == 0) { prime = false; break; }
        if (prime) { count++; Console.Write(n + " "); }
    }
    Console.WriteLine();
    Console.WriteLine(count);
  `),
  diag('cs0136-loop-variable-shadows',cs`
    using System;
    int i = 0;
    for (int i = 0; i < 3; i++) Console.WriteLine(i);
  `),
  diag('cs0103-loop-variable-out-of-scope',cs`
    using System;
    for (int i = 0; i < 3; i++) { }
    Console.WriteLine(i);
  `),
  diag('cs0029-while-int-condition',cs`
    using System;
    int n = 3;
    while (n) { n--; }
  `),
]),
...feature('switch',[
  out('int-switch',cs`
    using System;
    for (int i = 0; i < 5; i++)
    {
        switch (i)
        {
            case 0: Console.WriteLine("zero"); break;
            case 1:
            case 2: Console.WriteLine("one or two"); break;
            case 3: Console.WriteLine("three"); goto case 0;
            default: Console.WriteLine("many"); break;
        }
    }
  `),
  out('string-switch',cs`
    using System;
    string[] cmds = { "start", "stop", "other", null };
    foreach (string c in cmds)
    {
        switch (c)
        {
            case "start": Console.WriteLine("starting"); break;
            case "stop": Console.WriteLine("stopping"); break;
            case null: Console.WriteLine("null"); break;
            default: Console.WriteLine("unknown " + c); break;
        }
    }
  `),
  out('switch-expression',cs`
    using System;
    string Name(int n) => n switch
    {
        0 => "zero",
        1 => "one",
        < 0 => "negative",
        _ => "many",
    };
    Console.WriteLine(Name(0));
    Console.WriteLine(Name(1));
    Console.WriteLine(Name(-4));
    Console.WriteLine(Name(9));
  `),
  out('switch-with-when',cs`
    using System;
    string Describe(object o)
    {
        switch (o)
        {
            case int n when n > 10: return "big int";
            case int n: return "int " + n;
            case string s: return "string " + s.Length;
            case null: return "null";
            default: return "other";
        }
    }
    Console.WriteLine(Describe(50));
    Console.WriteLine(Describe(5));
    Console.WriteLine(Describe("abc"));
    Console.WriteLine(Describe(null));
    Console.WriteLine(Describe(1.5));
  `),
  out('switch-return-in-method',cs`
    using System;
    class Program
    {
        static int Days(int month)
        {
            switch (month)
            {
                case 2: return 28;
                case 4: case 6: case 9: case 11: return 30;
                default: return 31;
            }
        }
        static void Main()
        {
            Console.WriteLine(Days(2) + Days(4) + Days(12));
        }
    }
  `),
  out('switch-expression-unmatched-throws',cs`
    using System;
    int n = 3;
    try
    {
        string s = n switch { 1 => "one", 2 => "two" };
        Console.WriteLine(s);
    }
    catch (Exception e) { Console.WriteLine(e.GetType().Name); }
  `),
  diag('cs0163-fall-through',cs`
    using System;
    int n = 1;
    switch (n)
    {
        case 1: Console.WriteLine("one");
        case 2: Console.WriteLine("two"); break;
    }
  `),
  diag('cs8070-fall-out-of-last',cs`
    using System;
    int n = 1;
    switch (n)
    {
        case 1: Console.WriteLine("one"); break;
        default: Console.WriteLine("other");
    }
  `),
  diag('cs0152-duplicate-case',cs`
    using System;
    int n = 1;
    switch (n)
    {
        case 1: Console.WriteLine("one"); break;
        case 1: Console.WriteLine("uno"); break;
    }
  `),
  diag('cs9135-non-constant-case',cs`
    using System;
    int n = 1, m = 2;
    switch (n)
    {
        case m: Console.WriteLine("m"); break;
    }
  `),
  diag('cs0029-case-type-mismatch',cs`
    using System;
    int n = 1;
    switch (n)
    {
        case "one": Console.WriteLine("one"); break;
    }
  `),
  diag('cs8509-non-exhaustive-expression',cs`
    using System;
    int n = 3;
    string s = n switch { 1 => "one", 2 => "two" };
    Console.WriteLine(s);
  `),
  diag('cs8510-subsumed-arm',cs`
    using System;
    int n = 3;
    string s = n switch { _ => "any", 1 => "one" };
    Console.WriteLine(s);
  `),
]),
...feature('foreach',[
  out('over-array',cs`
    using System;
    int[] xs = { 3, 1, 4, 1, 5 };
    int sum = 0;
    foreach (int x in xs) sum += x;
    Console.WriteLine(sum);
    foreach (var s in new[] { "a", "b" }) Console.Write(s);
    Console.WriteLine();
  `),
  out('over-list',cs`
    using System;
    using System.Collections.Generic;
    var names = new List<string> { "ann", "bob", "cy" };
    foreach (string n in names)
    {
        if (n == "bob") continue;
        Console.WriteLine(n.ToUpper());
    }
  `),
  out('over-dictionary',cs`
    using System;
    using System.Collections.Generic;
    var ages = new Dictionary<string, int>();
    ages["ann"] = 30;
    ages["bob"] = 25;
    foreach (KeyValuePair<string, int> pair in ages) Console.WriteLine(pair.Key + "=" + pair.Value);
    foreach (var key in ages.Keys) Console.Write(key + " ");
    Console.WriteLine();
    int total = 0;
    foreach (int v in ages.Values) total += v;
    Console.WriteLine(total);
  `),
  out('over-string',cs`
    using System;
    int upper = 0;
    foreach (char c in "Hello World") if (char.IsUpper(c)) upper++;
    Console.WriteLine(upper);
  `),
  out('with-break-and-nested',cs`
    using System;
    int[][] rows = { new[] { 1, 2 }, new[] { 3, 4, 5 } };
    foreach (int[] row in rows)
    {
        foreach (int v in row)
        {
            if (v == 4) break;
            Console.WriteLine(v);
        }
    }
  `),
  out('custom-enumerable',cs`
    using System;
    using System.Collections.Generic;
    foreach (int n in Count(3)) Console.WriteLine(n);
    static IEnumerable<int> Count(int to)
    {
        for (int i = 1; i <= to; i++) yield return i * i;
    }
  `),
  diag('cs1656-assign-iteration-variable',cs`
    using System;
    int[] xs = { 1, 2 };
    foreach (int x in xs) { x = 5; }
  `),
  diag('cs1579-foreach-over-int',cs`
    using System;
    int n = 5;
    foreach (var x in n) Console.WriteLine(x);
  `),
  diag('cs0030-element-type-mismatch',cs`
    using System;
    string[] xs = { "a" };
    foreach (int x in xs) Console.WriteLine(x);
  `),
]),
...feature('definite-assignment',[
  out('assigned-on-all-paths',cs`
    using System;
    int x;
    bool flag = DateTime.MinValue.Year == 1;
    if (flag) x = 1; else x = 2;
    Console.WriteLine(x);
    int y;
    switch (x) { case 1: y = 10; break; default: y = 20; break; }
    Console.WriteLine(y);
  `),
  out('out-parameter-assigns',cs`
    using System;
    void Split(int v, out int q, out int r) { q = v / 3; r = v % 3; }
    int a, b;
    Split(10, out a, out b);
    Console.WriteLine(a + " " + b);
    Split(7, out int c, out var d);
    Console.WriteLine(c + " " + d);
  `),
  out('short-circuit-assigns',cs`
    using System;
    string text = "12";
    if (int.TryParse(text, out int n) && n > 10) Console.WriteLine(n);
    int m;
    if (text.Length == 2 && (m = 5) > 0) Console.WriteLine(m);
  `),
  diag('cs0165-simple',cs`
    using System;
    int x;
    Console.WriteLine(x);
  `),
  diag('cs0165-one-branch',cs`
    using System;
    class C
    {
        static void Main(string[] args)
        {
            int x;
            if (args.Length > 0) x = 1;
            Console.WriteLine(x);
        }
    }
  `),
  diag('cs0165-loop-body',cs`
    using System;
    class C
    {
        static void Main(string[] args)
        {
            int x;
            while (args.Length > 5) { x = 1; break; }
            Console.WriteLine(x);
        }
    }
  `),
  diag('cs0165-or-short-circuit',cs`
    using System;
    class C
    {
        static void Main(string[] args)
        {
            int m;
            if (args.Length == 0 || (m = 5) > 0) Console.WriteLine(m);
        }
    }
  `),
  diag('cs0165-try-catch',cs`
    using System;
    class C
    {
        static void Main()
        {
            int x;
            try { x = int.Parse("1"); }
            catch (Exception) { }
            Console.WriteLine(x);
        }
    }
  `),
  diag('cs0165-switch-missing-default',cs`
    using System;
    class C
    {
        static void Main(string[] args)
        {
            int y;
            switch (args.Length) { case 0: y = 1; break; case 1: y = 2; break; }
            Console.WriteLine(y);
        }
    }
  `),
  diag('cs0165-compound-assignment',cs`
    using System;
    int total;
    total += 5;
    Console.WriteLine(total);
  `),
  diag('cs0177-out-not-assigned',cs`
    using System;
    class C
    {
        static void Get(bool b, out int v) { if (b) v = 1; }
        static void Main() { Get(true, out int v); Console.WriteLine(v); }
    }
  `),
  diag('cs0269-out-read-before-assign',cs`
    using System;
    class C
    {
        static void Get(out int v) { Console.WriteLine(v); v = 1; }
        static void Main() { Get(out int v); Console.WriteLine(v); }
    }
  `),
  diag('cs0165-ref-argument',cs`
    using System;
    class C
    {
        static void Bump(ref int v) { v++; }
        static void Main() { int x; Bump(ref x); Console.WriteLine(x); }
    }
  `),
]),
...feature('reachability',[
  out('infinite-loop-returns',cs`
    using System;
    class Program
    {
        static int First(int[] xs)
        {
            int i = 0;
            while (true)
            {
                if (xs[i] > 2) return xs[i];
                i++;
            }
        }
        static int Fail() { throw new InvalidOperationException("x"); }
        static void Main()
        {
            Console.WriteLine(First(new[] { 1, 2, 3, 4 }));
            try { Fail(); } catch (InvalidOperationException e) { Console.WriteLine(e.Message); }
        }
    }
  `),
  diag('cs0161-missing-return',cs`
    using System;
    class C
    {
        static int F(int x) { if (x > 0) return 1; }
        static void Main() { Console.WriteLine(F(1)); }
    }
  `),
  diag('cs0161-empty-body',cs`
    using System;
    class C
    {
        static string Name() { }
        static void Main() { Console.WriteLine(Name()); }
    }
  `),
  diag('cs0161-loop-may-exit',cs`
    using System;
    class C
    {
        static int F(int n) { while (n > 0) { return n; } }
        static void Main() { Console.WriteLine(F(1)); }
    }
  `),
  diag('cs0162-after-return',cs`
    using System;
    class C
    {
        static int F() { return 1; Console.WriteLine("never"); }
        static void Main() { Console.WriteLine(F()); }
    }
  `),
  diag('cs0162-after-throw',cs`
    using System;
    class C
    {
        static void Main()
        {
            throw new Exception("x");
            Console.WriteLine("never");
        }
    }
  `),
  diag('cs0162-after-infinite-loop',cs`
    using System;
    class C
    {
        static void Main()
        {
            while (true) { }
            Console.WriteLine("never");
        }
    }
  `),
  diag('cs0162-constant-false-condition',cs`
    using System;
    class C
    {
        static void Main()
        {
            if (false) { Console.WriteLine("never"); }
            Console.WriteLine("always");
        }
    }
  `),
  diag('cs0162-after-break',cs`
    using System;
    class C
    {
        static void Main()
        {
            for (int i = 0; i < 3; i++) { break; Console.WriteLine(i); }
        }
    }
  `),
  diag('cs0162-after-continue-in-loop',cs`
    using System;
    class C
    {
        static void Main()
        {
            for (int i = 0; i < 3; i++) { Console.WriteLine(i); continue; i += 10; }
        }
    }
  `),
]),
...feature('unused-warnings',[
  diag('cs0168-declared-never-used',cs`
    using System;
    class C
    {
        static void Main() { int unused; Console.WriteLine(1); }
    }
  `),
  diag('cs0219-assigned-never-used',cs`
    using System;
    class C
    {
        static void Main() { int unused = 5; Console.WriteLine(1); }
    }
  `),
  diag('cs0168-catch-variable',cs`
    using System;
    class C
    {
        static void Main()
        {
            try { Console.WriteLine(1); }
            catch (Exception e) { Console.WriteLine(2); }
        }
    }
  `),
  diag('cs0219-string-constant',cs`
    using System;
    class C
    {
        static void Main() { string s = "x"; bool b = true; Console.WriteLine(1); }
    }
  `),
  diag('cs0169-unused-private-field',cs`
    using System;
    class C
    {
        private int never;
        static void Main() { Console.WriteLine(1); }
    }
  `),
  diag('cs0414-assigned-private-field',cs`
    using System;
    class C
    {
        private int counter = 3;
        static void Main() { Console.WriteLine(1); }
    }
  `),
  diag('cs0649-never-assigned-field',cs`
    using System;
    class C
    {
        private string name;
        static void Main() { Console.WriteLine(new C().name == null); }
    }
  `),
  diag('cs8321-unused-local-function',cs`
    using System;
    class C
    {
        static void Main() { void Helper() { } Console.WriteLine(1); }
    }
  `),
  diag('cs1717-self-assignment',cs`
    using System;
    class C
    {
        static void Main() { int x = 1; x = x; Console.WriteLine(x); }
    }
  `),
]),
...feature('exceptions',[
  out('try-catch-finally-order',cs`
    using System;
    try
    {
        Console.WriteLine("try");
        throw new InvalidOperationException("boom");
    }
    catch (InvalidOperationException e)
    {
        Console.WriteLine("catch " + e.Message);
    }
    finally
    {
        Console.WriteLine("finally");
    }
    Console.WriteLine("after");
  `),
  out('catch-by-type',cs`
    using System;
    void Run(int kind)
    {
        try
        {
            if (kind == 0) throw new ArgumentException("arg");
            if (kind == 1) throw new InvalidOperationException("op");
            if (kind == 2) throw new Exception("base");
            Console.WriteLine("none");
        }
        catch (ArgumentException e) { Console.WriteLine("A:" + e.Message); }
        catch (InvalidOperationException e) { Console.WriteLine("I:" + e.Message); }
        catch (Exception e) { Console.WriteLine("E:" + e.Message); }
    }
    for (int i = 0; i < 4; i++) Run(i);
  `),
  out('custom-exception',cs`
    using System;
    try { throw new AppError(42, "custom"); }
    catch (AppError e) { Console.WriteLine(e.Code + " " + e.Message); }
    class AppError : Exception
    {
        public int Code { get; }
        public AppError(int code, string message) : base(message) { Code = code; }
    }
  `),
  out('rethrow-and-nested',cs`
    using System;
    try
    {
        try { throw new Exception("inner"); }
        catch (Exception e) { Console.WriteLine("first " + e.Message); throw; }
        finally { Console.WriteLine("inner finally"); }
    }
    catch (Exception e) { Console.WriteLine("second " + e.Message); }
  `),
  out('finally-on-return',cs`
    using System;
    int F()
    {
        try { Console.WriteLine("body"); return 1; }
        finally { Console.WriteLine("cleanup"); }
    }
    Console.WriteLine(F());
  `),
  out('exception-filter',cs`
    using System;
    void Run(int code)
    {
        try { throw new Exception("code" + code); }
        catch (Exception e) when (code == 1) { Console.WriteLine("filtered " + e.Message); }
        catch (Exception e) { Console.WriteLine("general " + e.Message); }
    }
    Run(1);
    Run(2);
  `),
  out('inner-exception',cs`
    using System;
    try
    {
        try { throw new FormatException("bad format"); }
        catch (Exception e) { throw new InvalidOperationException("wrapped", e); }
    }
    catch (Exception e)
    {
        Console.WriteLine(e.Message);
        Console.WriteLine(e.InnerException.Message);
        Console.WriteLine(e.InnerException is FormatException);
    }
  `),
  out('runtime-exceptions',cs`
    using System;
    string s = null;
    try { Console.WriteLine(s.Length); }
    catch (NullReferenceException) { Console.WriteLine("null reference"); }
    int[] xs = new int[2];
    try { xs[2] = 1; }
    catch (IndexOutOfRangeException) { Console.WriteLine("index"); }
    try { throw null; }
    catch (NullReferenceException) { Console.WriteLine("throw null"); }
  `),
  out('throw-expression',cs`
    using System;
    string Require(string s) => s ?? throw new ArgumentNullException("s");
    Console.WriteLine(Require("ok"));
    try { Require(null); }
    catch (ArgumentNullException e) { Console.WriteLine(e.ParamName); }
  `),
  out('unhandled-exception',cs`
    using System;
    Console.WriteLine("before");
    throw new InvalidOperationException("unhandled");
  `),
  diag('cs0160-catch-order',cs`
    using System;
    try { Console.WriteLine(1); }
    catch (Exception) { }
    catch (ArgumentException) { }
  `),
  diag('cs0029-throw-non-exception',cs`
    using System;
    Console.WriteLine(1);
    throw "text";
  `),
  diag('cs0156-rethrow-outside-catch',cs`
    using System;
    Console.WriteLine(1);
    throw;
  `),
  diag('cs0157-return-in-finally',cs`
    using System;
    class C
    {
        static void Main()
        {
            try { Console.WriteLine(1); }
            finally { return; }
        }
    }
  `),
  diag('cs1524-try-without-catch',cs`
    using System;
    try { Console.WriteLine(1); }
    Console.WriteLine(2);
  `),
  diag('cs0155-catch-non-exception',cs`
    using System;
    try { Console.WriteLine(1); }
    catch (string s) { }
  `),
]),
...feature('using-dispose',[
  out('using-statement',cs`
    using System;
    using (var r = new Resource("a"))
    {
        Console.WriteLine("using " + r.Name);
    }
    Console.WriteLine("after");
    class Resource : IDisposable
    {
        public string Name;
        public Resource(string name) { Name = name; Console.WriteLine("open " + name); }
        public void Dispose() { Console.WriteLine("dispose " + Name); }
    }
  `),
  out('using-declaration',cs`
    using System;
    void Work()
    {
        using var a = new Resource("a");
        using var b = new Resource("b");
        Console.WriteLine("work");
    }
    Work();
    Console.WriteLine("after");
    class Resource : IDisposable
    {
        string name;
        public Resource(string name) { this.name = name; }
        public void Dispose() { Console.WriteLine("dispose " + name); }
    }
  `),
  out('dispose-on-exception',cs`
    using System;
    try
    {
        using (new Resource())
        {
            throw new Exception("fail");
        }
    }
    catch (Exception e) { Console.WriteLine("caught " + e.Message); }
    class Resource : IDisposable
    {
        public void Dispose() { Console.WriteLine("disposed"); }
    }
  `),
  out('nested-and-null',cs`
    using System;
    using (Resource a = new Resource("a"), b = new Resource("b"))
    using (Resource c = null)
    {
        Console.WriteLine("body");
    }
    class Resource : IDisposable
    {
        string name;
        public Resource(string name) { this.name = name; }
        public void Dispose() { Console.WriteLine("dispose " + name); }
    }
  `),
  diag('cs1674-not-disposable',cs`
    using System;
    using (var s = "text") { Console.WriteLine(s); }
  `),
  diag('cs1656-assign-using-variable',cs`
    using System;
    using System.IO;
    using (var r = new StringReader("x")) { r = null; }
  `),
]),
...feature('syntax',[
  diag('cs1003-missing-semicolon-before-statement',cs`
    using System;
    int x = 1
    Console.WriteLine(x);
  `),
  diag('cs1002-missing-semicolon',cs`
    using System;
    Console.WriteLine(1)
  `),
  diag('cs1513-missing-close-brace',cs`
    using System;
    class C
    {
        static void Main() { Console.WriteLine(1);
    }
  `),
  diag('cs1525-invalid-expression-term',cs`
    using System;
    int x = ;
    Console.WriteLine(x);
  `),
  diag('cs1026-missing-close-paren',cs`
    using System;
    Console.WriteLine((1 + 2;
  `),
  diag('cs1003-missing-comma-or-colon',cs`
    using System;
    bool b = true;
    int x = b ? 1 2;
    Console.WriteLine(x);
  `),
  diag('cs1010-newline-in-constant',cs`
    using System;
    string s = "unterminated;
    Console.WriteLine(s);
  `),
  diag('cs8803-statement-after-type',cs`
    using System;
    class C { }
    Console.WriteLine(1);
  `),
]),
];
