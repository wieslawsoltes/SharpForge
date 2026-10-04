using System;
using System.Runtime.CompilerServices;

// Delegates over extension methods (closed over the receiver), delegate equality, delegate types the compiler
// declares for lambdas with optional, `params` and by-reference parameters, and module initializers next to a type
// initializer of the entry point's type.

class Counter
{
    public int Count;
    public void Increment() { Count++; }
}

static class CounterExtensions
{
    public static void Bump(this Counter counter) { counter.Count += 10; }
    public static int Plus(this Counter counter, int amount) { return counter.Count + amount; }
    public static int Size(this string text) { return text.Length; }
    public static string Describe(this object value) { return "object:" + value; }
    public static string Describe(this string value) { return "string:" + value; }
}

static class Startup
{
    public static string Log = "";
    [ModuleInitializer] internal static void First() { Log += "first;"; }
    [ModuleInitializer] internal static void Second() { Log += "second;"; }
}

class Program
{
    static readonly string AtTypeInitializer = Startup.Log;

    static string Make(ref int calls) { calls++; return "made" + calls; }
    static void Hello() { }

    static void ExtensionDelegates()
    {
        var counter = new Counter();
        Action bump = counter.Bump;
        bump();
        bump += counter.Bump;
        bump();
        Func<int, int> plus = counter.Plus;
        Console.WriteLine(counter.Count + " " + plus(5));
        int calls = 0;
        Func<int> length = Make(ref calls).Size;
        Console.WriteLine(calls + " " + length() + " " + length() + " " + calls);
        Func<string> describe = "text".Describe;
        Console.WriteLine(describe());
    }

    static void Equality()
    {
        var counter = new Counter();
        var other = new Counter();
        Action a = counter.Increment, b = counter.Increment, c = other.Increment;
        Action x = counter.Bump, y = counter.Bump, z = other.Bump;
        Action first = Hello, second = Hello, none = null;
        Delegate plain = b;
        Console.WriteLine((a == b) + " " + (a != b) + " " + (a == c) + " " + (x == y) + " " + (x == z) + " " + (x == a));
        Console.WriteLine((first == second) + " " + (first == null) + " " + (none == null) + " " + (null != first));
        Console.WriteLine((plain == a) + " " + ((object)a == (object)b) + " " + (a + c == a + c) + " " + (a + c == c + a));
    }

    static void SynthesizedDelegates()
    {
        var add = (int left, int right = 10) => left + right;
        var same = (int left, int right = 10) => left * right;
        Console.WriteLine(add(1) + " " + add(1, 2));
        add = same;
        Console.WriteLine(add(3));
        var total = (params int[] values) => values.Length;
        Console.WriteLine(total() + " " + total(1, 2, 3));
        var swap = (ref int left, ref int right) => { int kept = left; left = right; right = kept; };
        int one = 1, two = 2;
        swap(ref one, ref two);
        Console.WriteLine(one + " " + two);
    }

    static void Main()
    {
        Console.WriteLine(AtTypeInitializer + " " + Startup.Log);
        ExtensionDelegates();
        Equality();
        SynthesizedDelegates();
    }
}
