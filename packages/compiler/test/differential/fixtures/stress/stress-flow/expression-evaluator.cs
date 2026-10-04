using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public abstract record Expr;
public sealed record Num(double Value) : Expr;
public sealed record Var(string Name) : Expr;
public sealed record Unary(char Op, Expr Operand) : Expr;
public sealed record Binary(char Op, Expr Left, Expr Right) : Expr;
public sealed record Call(string Function, IReadOnlyList<Expr> Arguments) : Expr;

public class ParseException : Exception
{
    public int Position { get; }
    public ParseException(string message, int position) : base(message) { Position = position; }
}

public sealed class Parser
{
    private readonly string text;
    private int position;

    public Parser(string text) { this.text = text; }

    public Expr Parse()
    {
        var result = ParseSum();
        SkipSpaces();
        if (position < text.Length) throw new ParseException("unexpected '" + text[position] + "'", position);
        return result;
    }

    private void SkipSpaces() { while (position < text.Length && char.IsWhiteSpace(text[position])) position++; }

    private bool Accept(char c)
    {
        SkipSpaces();
        if (position < text.Length && text[position] == c) { position++; return true; }
        return false;
    }

    private Expr ParseSum()
    {
        var left = ParseProduct();
        while (true)
        {
            if (Accept('+')) left = new Binary('+', left, ParseProduct());
            else if (Accept('-')) left = new Binary('-', left, ParseProduct());
            else return left;
        }
    }

    private Expr ParseProduct()
    {
        var left = ParsePower();
        while (true)
        {
            if (Accept('*')) left = new Binary('*', left, ParsePower());
            else if (Accept('/')) left = new Binary('/', left, ParsePower());
            else return left;
        }
    }

    private Expr ParsePower()
    {
        var operand = ParseUnary();
        return Accept('^') ? new Binary('^', operand, ParsePower()) : operand;
    }

    private Expr ParseUnary() => Accept('-') ? new Unary('-', ParseUnary()) : ParsePrimary();

    private Expr ParsePrimary()
    {
        SkipSpaces();
        if (position >= text.Length) throw new ParseException("unexpected end", position);
        char c = text[position];
        if (c == '(')
        {
            position++;
            var inner = ParseSum();
            if (!Accept(')')) throw new ParseException("expected ')'", position);
            return inner;
        }
        int start = position;
        if (char.IsDigit(c))
        {
            while (position < text.Length && (char.IsDigit(text[position]) || text[position] == '.')) position++;
            return new Num(double.Parse(text.Substring(start, position - start), CultureInfo.InvariantCulture));
        }
        if (char.IsLetter(c))
        {
            while (position < text.Length && char.IsLetterOrDigit(text[position])) position++;
            string name = text[start..position];
            if (!Accept('(')) return new Var(name);
            var arguments = new List<Expr>();
            if (!Accept(')'))
            {
                do arguments.Add(ParseSum()); while (Accept(','));
                if (!Accept(')')) throw new ParseException("expected ')' after arguments", position);
            }
            return new Call(name, arguments);
        }
        throw new ParseException("unexpected '" + c + "'", position);
    }
}

public static class Evaluator
{
    public static double Evaluate(Expr expr, IReadOnlyDictionary<string, double> env) => expr switch
    {
        Num n => n.Value,
        Var v when env.TryGetValue(v.Name, out var value) => value,
        Var v => throw new KeyNotFoundException("unbound " + v.Name),
        Unary { Op: '-', Operand: var operand } => -Evaluate(operand, env),
        Binary { Op: '+' } b => Evaluate(b.Left, env) + Evaluate(b.Right, env),
        Binary { Op: '-' } b => Evaluate(b.Left, env) - Evaluate(b.Right, env),
        Binary { Op: '*' } b => Evaluate(b.Left, env) * Evaluate(b.Right, env),
        Binary { Op: '/', Right: var right } b => Evaluate(right, env) is var d && d == 0 ? double.NaN : Evaluate(b.Left, env) / d,
        Binary { Op: '^' } b => Math.Pow(Evaluate(b.Left, env), Evaluate(b.Right, env)),
        Call { Function: "max", Arguments: { Count: > 0 } args } => args.Max(a => Evaluate(a, env)),
        Call { Function: "sqrt", Arguments: [var single] } => Math.Sqrt(Evaluate(single, env)),
        Call { Function: var f, Arguments: var a } => throw new InvalidOperationException($"bad call {f}/{a.Count}"),
        _ => throw new NotSupportedException(expr.GetType().Name),
    };

    public static Expr Simplify(Expr expr) => expr switch
    {
        Binary('+', Num(0), var r) => Simplify(r),
        Binary('+', var l, Num(0)) => Simplify(l),
        Binary('*', Num(1), var r) => Simplify(r),
        Binary('*', var l, Num(1)) => Simplify(l),
        Binary('*', Num(0), _) or Binary('*', _, Num(0)) => new Num(0),
        Binary(var op, var l, var r) => Fold(new Binary(op, Simplify(l), Simplify(r))),
        Unary('-', Unary('-', var inner)) => Simplify(inner),
        Unary(var op, var inner) => new Unary(op, Simplify(inner)),
        _ => expr,
    };

    private static Expr Fold(Binary b) => b is { Left: Num(var x), Right: Num(var y), Op: var op and not '/' }
        ? new Num(Evaluate(new Binary(op, new Num(x), new Num(y)), new Dictionary<string, double>()))
        : b;

    public static string Show(Expr expr) => expr switch
    {
        Num n => n.Value.ToString("0.###", CultureInfo.InvariantCulture),
        Var v => v.Name,
        Unary u => "(" + u.Op + Show(u.Operand) + ")",
        Binary b => "(" + Show(b.Left) + " " + b.Op + " " + Show(b.Right) + ")",
        Call c => c.Function + "(" + string.Join(", ", c.Arguments.Select(Show)) + ")",
        _ => "?",
    };

    public static int Depth(Expr expr) => expr switch
    {
        Unary u => 1 + Depth(u.Operand),
        Binary b => 1 + Math.Max(Depth(b.Left), Depth(b.Right)),
        Call c => 1 + c.Arguments.Select(Depth).DefaultIfEmpty(0).Max(),
        _ => 1,
    };
}

public static class Program
{
    public static void Main()
    {
        var env = new Dictionary<string, double> { ["x"] = 3, ["y"] = 4.5, ["zero"] = 0 };
        string[] inputs =
        {
            "1 + 2 * 3", "(1 + 2) * 3", "-x ^ 2", "2 ^ 3 ^ 2", "sqrt(x * x + 16)", "max(x, y, 10 / 4)",
            "x / zero", "0 + x * 1", "--y", "1 + (2 * 3 + 0) * (4 - 4)", "unknown + 1", "f(1)", "(1 + 2", "3 $ 4", "max()",
        };
        foreach (var input in inputs)
        {
            try
            {
                var tree = new Parser(input).Parse();
                var simple = Evaluator.Simplify(tree);
                double value = Evaluator.Evaluate(tree, env);
                Console.WriteLine($"{input,-28} => {Evaluator.Show(simple),-24} = {value.ToString("0.####", CultureInfo.InvariantCulture)} depth {Evaluator.Depth(tree)}");
            }
            catch (ParseException e) { Console.WriteLine($"{input,-28} parse error at {e.Position}: {e.Message}"); }
            catch (Exception e) when (e is KeyNotFoundException or InvalidOperationException) { Console.WriteLine($"{input,-28} {e.GetType().Name}: {e.Message}"); }
        }
        var a = new Binary('+', new Num(1), new Var("x"));
        var b = new Binary('+', new Num(1), new Var("x"));
        Console.WriteLine(a == b);
        Console.WriteLine(a with { Op = '-' });
        Console.WriteLine(a.Equals((object)b) + " " + (a.GetHashCode() == b.GetHashCode()));
        var (op, left, _) = a;
        Console.WriteLine(op + " " + left);
    }
}
