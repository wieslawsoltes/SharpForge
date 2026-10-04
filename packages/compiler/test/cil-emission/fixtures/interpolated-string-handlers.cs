using System;
using System.Runtime.CompilerServices;

// Interpolated string handlers (C# 10): class and struct handlers, alignment and format arguments, a generic
// AppendFormatted, the `out bool` constructor that switches the appending off, appending calls that return bool,
// and handlers as operands of larger expressions, in lambdas and in loops.

[InterpolatedStringHandler]
class Trace
{
    string text;
    public Trace(int literalLength, int formattedCount) { text = "[" + literalLength + "," + formattedCount + "]"; }
    public void AppendLiteral(string value) { text += "L(" + value + ")"; }
    public void AppendFormatted(int value) { text += "I(" + value + ")"; }
    public void AppendFormatted(int value, int alignment = 0, string format = null) { text += "I(" + value + "," + alignment + "," + (format ?? "-") + ")"; }
    public void AppendFormatted<T>(T value) { text += "T(" + value + ")"; }
    public string Result() { return text; }
}

[InterpolatedStringHandler]
struct Counting
{
    public int Literals;
    public int Holes;
    public Counting(int literalLength, int formattedCount) { Literals = 0; Holes = 0; }
    public void AppendLiteral(string value) { Literals++; }
    public void AppendFormatted<T>(T value) { Holes++; }
}

[InterpolatedStringHandler]
class Guarded
{
    string text = "";
    public Guarded(int literalLength, int formattedCount, out bool enabled) { enabled = Program.Enabled; }
    public void AppendLiteral(string value) { text += value; }
    public void AppendFormatted(int value) { text += value; }
    public string Result() { return text == "" ? "(off)" : text; }
}

[InterpolatedStringHandler]
class Limited
{
    string text = "";
    int budget;
    public Limited(int literalLength, int formattedCount, out bool enabled) { budget = formattedCount; enabled = formattedCount > 0; }
    public bool AppendLiteral(string value) { text += value; return true; }
    public bool AppendFormatted(int value) { text += "<" + value + ">"; budget--; return budget > 0 && value < 10; }
    public string Result() { return text == "" ? "(none)" : text; }
}

class Program
{
    public static bool Enabled;
    static int calls;
    static int Next() { return ++calls; }

    static string Show(Trace trace) { return trace.Result(); }
    static int Parts(Counting counting) { return counting.Literals * 10 + counting.Holes; }
    static Trace Make(int number) { return $"made {number}"; }

    static void Main()
    {
        int number = 3;
        string word = "x";
        Console.WriteLine(Show($"a {number} b {word} c"));
        Console.WriteLine(Show($"") + Show($"only text") + Show($"{number}{word}"));
        Console.WriteLine(Show($"aligned {number,5} formatted {number:X2} both {number,-4:D3} braces {{{number}}}"));
        Console.WriteLine("made: " + Make(7).Result() + " cast: " + ((Trace)$"cast {word}").Result());

        Counting counting = $"a {1} b {"two"} c {3.5}";
        Console.WriteLine(counting.Literals + " " + counting.Holes + " " + Parts($"{1}{2}") + " " + (1 + Parts($"x{number}y")));

        Guarded off = $"value {Next()}";
        Enabled = true;
        Guarded on = $"value {Next()}";
        Console.WriteLine(off.Result() + " " + on.Result() + " calls=" + calls);

        Limited none = $"only text";
        Limited some = $"p{5}q{50}r{Next()}s";
        Limited all = $"{1}-{2}";
        Console.WriteLine(none.Result() + " " + some.Result() + " " + all.Result() + " calls=" + calls);

        Func<int, string> describe = value => Show($"in lambda {value} and {number}");
        Console.WriteLine(describe(9));
        string joined = "";
        for (int index = 0; index < 3; index++) joined += Show($"{index}") + ";";
        Console.WriteLine(joined);
    }
}
