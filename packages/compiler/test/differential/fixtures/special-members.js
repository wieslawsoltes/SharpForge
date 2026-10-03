/**
 * Differential fixtures for SF-A02-T48 (C# 1 destructors, extern members, `operator true`/`operator false` and the
 * short-circuit forms of user-defined `&` and `|`).
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('special-members', [
    out(
      'destructor-and-extern-declarations-do-not-run',
      cs`
    using System;
    using System.Runtime.InteropServices;
    class Native
    {
        [DllImport("kernel32")]
        public static extern int Beep(int frequency, int duration);
        [DllImport("user32", EntryPoint = "MessageBoxW", SetLastError = true)]
        static extern int Show(int owner, string text, string caption, int type);
        public static int Calls;
    }
    class Resource
    {
        string name;
        public Resource(string name) { this.name = name; Console.WriteLine("open " + name); }
        ~Resource() { name = null; }
        public void Close() { Console.WriteLine("close " + name); }
    }
    class Program
    {
        static void Main()
        {
            Resource r = new Resource("a");
            r.Close();
            new Resource("b");
            Native.Calls++;
            Console.WriteLine(Native.Calls);
        }
    }
    `,
    ),
    out(
      'short-circuit-user-operators',
      cs`
    using System;
    class Tri
    {
        public int v;
        public Tri(int v) { this.v = v; }
        public static bool operator true(Tri t) { Console.WriteLine("true? " + t.v); return t.v > 0; }
        public static bool operator false(Tri t) { Console.WriteLine("false? " + t.v); return t.v <= 0; }
        public static Tri operator &(Tri a, Tri b) { Console.WriteLine("and"); return new Tri(a.v < b.v ? a.v : b.v); }
        public static Tri operator |(Tri a, Tri b) { Console.WriteLine("or"); return new Tri(a.v > b.v ? a.v : b.v); }
        public static Tri operator !(Tri a) { return new Tri(-a.v); }
    }
    class Program
    {
        static Tri Make(int v) { Console.WriteLine("make " + v); return new Tri(v); }
        static void Main()
        {
            Tri a = Make(1) && Make(0);
            Console.WriteLine(a.v);
            Tri b = Make(1) || Make(5);
            Console.WriteLine(b.v);
            Tri c = Make(0) && Make(5);
            Console.WriteLine(c.v);
            Tri d = Make(0) || Make(5);
            Console.WriteLine(d.v);
            if (Make(3)) Console.WriteLine("yes"); else Console.WriteLine("no");
            Console.WriteLine(Make(0) ? "t" : "f");
            while (Make(0)) { }
            int n = 2;
            do { n--; } while (Make(n));
            for (int i = 1; Make(i); i--) Console.WriteLine("loop " + i);
            if (!Make(-2)) Console.WriteLine("negated");
            if (Make(1) && Make(2)) Console.WriteLine("both");
            if (Make(1) && Make(2) || Make(3)) Console.WriteLine("chain");
        }
    }
    `,
    ),
    diag(
      'destructor-rules',
      cs`
    class Twice
    {
        ~Twice() { }
        ~Twice() { }
    }
    class Wrong
    {
        public ~Other() { }
    }
    class Modifiers
    {
        static ~Modifiers() { }
    }
    static class Static
    {
        ~Static() { }
    }
    struct S
    {
        ~S() { }
    }
    class Program
    {
        static void Main() { }
    }
    `,
    ),
    diag(
      'extern-rules',
      cs`
    using System;
    using System.Runtime.InteropServices;
    abstract class Native
    {
        public static extern int NoImport();
        [DllImport("kernel32")]
        public static extern int Beep(int a, int b);
        [Obsolete]
        public static extern int OtherAttribute();
        public static extern int WithBody() { return 1; }
        public extern Native(int a);
        [DllImport("x")]
        public extern int Instance();
        [DllImport("x")]
        public static int NotExtern() { return 0; }
        public abstract extern void Both();
        public static extern int Property { get; set; }
        public static extern Native operator +(Native a, Native b);
        public extern event Action Changed;
        extern ~Native();
        public static int Missing();
    }
    class Program
    {
        static void Main() { }
    }
    `,
    ),
  ]),
];
