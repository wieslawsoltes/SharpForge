using System;
using System.Collections.Generic;
using System.Linq;

public abstract record Expr;
public sealed record Num(double Value) : Expr;
public sealed record Var(string Name) : Expr;

public static class Program
{
    // A guard that ends in an invocation stands directly before the arrow of its arm: `M(a, out var b) => value`.
    static double Evaluate(Expr expr, IReadOnlyDictionary<string, double> env) => expr switch
    {
        Num n => n.Value,
        Var v when env.TryGetValue(v.Name, out var value) => value,
        Var v => throw new KeyNotFoundException("unbound " + v.Name),
        _ => throw new NotSupportedException(expr.GetType().Name),
    };

    static string Kind(object value) => value switch
    {
        string s when s.All(char.IsUpper) => "upper",
        string s when s.Contains("x") => "has x",
        int n when Math.Abs(n) > 10 => "big",
        string => "text",
        _ => "other",
    };

    static string Rank(int rank) => rank switch { 1 or 14 => "ace", >= 2 and <= 10 => rank.ToString(), _ => throw new ArgumentOutOfRangeException(nameof(rank)) };

    static int Statement(int rank)
    {
        return rank switch { 1 => 10, var other => other < 0 ? throw new InvalidOperationException("negative") : other };
    }

    // A lambda with a return type is still a lambda: its parentheses hold parameters, not arguments.
    static Func<int, int> Typed(bool twice)
    {
        Func<int, int> doubled = int (int x) => x * 2, same = static int (x) => x;
        var parsed = int (string text, out bool ok) => (ok = int.TryParse(text, out int value)) ? value : -1;
        if (twice) return doubled;
        return x => same(x) + parsed("40", out _);
    }

    public static void Main()
    {
        var env = new Dictionary<string, double> { ["x"] = 3 };
        Console.WriteLine(Evaluate(new Num(1), env) + " " + Evaluate(new Var("x"), env));
        try { Evaluate(new Var("y"), env); } catch (KeyNotFoundException e) { Console.WriteLine(e.Message); }
        try { Evaluate(null, env); } catch (NullReferenceException) { Console.WriteLine("null expr"); }
        Console.WriteLine(string.Join(",", new object[] { "ABC", "axb", "abc", 42, 3 }.Select(Kind)));
        Console.WriteLine(Rank(1) + Rank(7) + Statement(1) + Statement(5) + Typed(true)(4) + Typed(false)(4));
        try { Rank(0); } catch (ArgumentOutOfRangeException e) { Console.WriteLine(e.ParamName); }
        try { Statement(-1); } catch (InvalidOperationException e) { Console.WriteLine(e.Message); }
    }
}
