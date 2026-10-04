using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;

public class Formatter
{
    public virtual string Format(string text, int width = 10, char fill = ' ', bool right = false) => right ? text.PadLeft(width, fill) : text.PadRight(width, fill);
    public string Join(string separator, params object[] parts) => "o:" + string.Join(separator, parts);
    public string Join(string separator, params string[] parts) => "s:" + string.Join(separator, parts);
    public string Join(string separator, IEnumerable<int> parts) => "e:" + string.Join(separator, parts);
    public string Join(string single) => "1:" + single;
}

public class WideFormatter : Formatter
{
    public override string Format(string text, int width = 20, char fill = '.', bool right = true) => "[" + base.Format(text, width, fill, right) + "]";
}

public static class Program
{
    private static int Sum(params int[] values) => values.Sum();
    private static string Sum(string label, params int[] values) => label + "=" + values.Sum();
    private static double Sum(double first, params double[] rest) => first + rest.Sum();
    private static int Count<T>(params T[] items) => items?.Length ?? -1;
    private static string Span(params ReadOnlySpan<char> letters) => letters.Length + ":" + letters.ToString();
    private static string List(params List<string> items) => items.Count + "/" + string.Join("", items);

    private static string Order(int a, int b = 2, int c = 3, params int[] rest) => $"{a},{b},{c}+{rest.Length}";
    private static string Defaults(string text = "none", int number = -1, double ratio = 0.5, char letter = 'z', bool flag = true, string missing = null,
        ConsoleColor color = ConsoleColor.Red, decimal money = 1.5m, int? optional = null, DateTime when = default, long big = long.MaxValue)
        => $"{text} {number} {ratio} {letter} {flag} {missing ?? "null"} {color} {money} {optional?.ToString() ?? "null"} {when.Ticks} {big}";

    private static string Where([CallerMemberName] string member = "", [CallerLineNumber] int line = 0) => member + (line > 0 ? ":line" : ":none");
    private static string Expression(bool condition, [CallerArgumentExpression(nameof(condition))] string text = null) => text + " is " + condition;

    private static int counter;
    private static int Next(string label, List<string> order)
    {
        order.Add(label);
        return ++counter;
    }

    private static string Evaluate(int first, int second, int third) => $"{first}{second}{third}";
    private static void Out(out int a, out string b, int seed = 7) { a = seed * 2; b = "s" + seed; }
    private static ref int Pick(ref int a, ref int b, bool first = true) => ref first ? ref a : ref b;
    private static T Create<T>(T value = default, Func<T, T> transform = null) => transform == null ? value : transform(value);

    public static void Main()
    {
        Console.WriteLine(Sum() + " " + Sum(1) + " " + Sum(1, 2, 3) + " " + Sum(new[] { 4, 5 }) + " " + Sum("x") + " " + Sum("y", 1, 2) + " " + Sum(1.5) + " " + Sum(1.5, 2) + " " + Sum(1, 2.5));
        Console.WriteLine(Count<int>() + " " + Count(1, 2) + " " + Count("a") + " " + Count<string>(null) + " " + Count<object>(null, null) + " " + Count(new[] { 1, 2, 3 }) + " " + Count<object>(new[] { "a", "b" }) + " " + Count(new object[] { 1 }, new object[0]));
        Console.WriteLine(Span() + " " + Span('a', 'b') + " " + Span("xyz") + " " + List() + " " + List("p", "q") + " " + List(new List<string> { "r" }));
        Console.WriteLine(Order(1) + " " + Order(1, 9) + " " + Order(1, c: 9) + " " + Order(c: 7, a: 8) + " " + Order(1, 2, 3, 4, 5) + " " + Order(b: 5, a: 4, c: 6, rest: new[] { 1 }) + " " + Order(1, 2, 3, rest: 9));
        Console.WriteLine(Defaults());
        Console.WriteLine(Defaults("t", flag: false, optional: 5, color: ConsoleColor.Blue, big: 1, when: new DateTime(1)));
        Console.WriteLine(Where() + " " + Where("explicit") + " " + Where(line: 0) + " " + Expression(1 + 1 == 2) + " | " + Expression(counter > 100, "custom"));

        var order = new List<string>();
        string result = Evaluate(third: Next("third", order), first: Next("first", order), second: Next("second", order));
        Console.WriteLine(result + " " + string.Join(">", order));
        Out(out int doubled, out var text);
        Out(b: out string named, a: out _, seed: 3);
        int left = 1, right = 2;
        Pick(ref left, ref right) = 10;
        Pick(ref left, ref right, first: false) += 20;
        Console.WriteLine(doubled + text + named + " " + left + "," + right + " " + Create<int>() + Create(5, v => v * 2) + (Create<string>() ?? "null") + Create(transform: (string s) => s + "!", value: "hi"));

        Formatter formatter = new WideFormatter();
        var wide = new WideFormatter();
        Console.WriteLine(formatter.Format("ab") + "|" + wide.Format("ab") + "|" + formatter.Format("ab", fill: '*', width: 5) + "|" + wide.Format(right: false, text: "cd", width: 4));
        Console.WriteLine(string.Join(" ", formatter.Join("-", "a", "b"), formatter.Join("-", 1, "b"), formatter.Join("-", 1, 2), formatter.Join("-", new[] { 1, 2 }), formatter.Join("-", new List<int> { 3 }), formatter.Join("-"), formatter.Join("-", (object)"x"), formatter.Join("-", null, null)));
        Func<int, int, int> subtract = (x, y) => x - y;
        var withDefault = (int x, int y = 10) => x * y;
        var withParams = (params int[] xs) => xs.Length;
        Console.WriteLine(subtract(arg2: 1, arg1: 5) + " " + withDefault(3) + " " + withDefault(3, 2) + " " + withParams() + withParams(1, 2, 3));
        Console.WriteLine(string.Format("{0}{1}{2}{3}{4}", 1, "b", 'c', 4.5, null) + string.Concat(1, 2, 3, 4, 5) + Math.Max(1, 2L).GetType().Name + string.Join(",", 1, 2, 3) + string.Join(",", new[] { "x" }, "y").Length);
    }
}
