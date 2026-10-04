using System;
using System.Collections.Generic;
using System.Linq;

public abstract record Token;
public sealed record Number(double Value) : Token;
public sealed record Operator(char Symbol) : Token;
public sealed record Paren(bool Open) : Token;

public readonly record struct Point(int X, int Y);
public sealed record Line(Point From, Point To);

public static class Program
{
    private static string Shape(int[] values) => values switch
    {
        [] => "empty",
        [var single] => "one " + single,
        [0, .., 0] => "zero-bounded " + values.Length,
        [var first, var second] => "pair " + (first + second),
        [1, 2, .. var rest] => "1,2 then " + rest.Length,
        [.., < 0] => "ends negative",
        [> 100, ..] => "starts big",
        [_, _, _] => "triple",
        [var head, .. { Length: > 3 } middle, var tail] => $"long {head}..{tail} mid {middle.Sum()}",
        _ => "other",
    };

    private static double Evaluate(ReadOnlySpan<Token> tokens)
    {
        switch (tokens)
        {
            case [Number n]:
                return n.Value;
            case [Paren { Open: true }, .. var inner, Paren { Open: false }] when Balanced(inner):
                return Evaluate(inner);
            case [Operator { Symbol: '-' }, .. var operand]:
                return -Evaluate(operand);
        }
        int depth = 0, split = -1, priority = int.MaxValue;
        for (int i = tokens.Length - 1; i >= 0; i--)
        {
            switch (tokens[i])
            {
                case Paren { Open: false }: depth++; break;
                case Paren { Open: true }: depth--; break;
                case Operator { Symbol: var symbol } when depth == 0 && i > 0 && tokens[i - 1] is not Operator:
                    int current = symbol is '+' or '-' ? 1 : 2;
                    if (current < priority) { priority = current; split = i; }
                    break;
            }
        }
        if (split < 0) throw new FormatException("cannot evaluate " + tokens.Length + " tokens");
        double left = Evaluate(tokens.Slice(0, split)), right = Evaluate(tokens.Slice(split + 1));
        return ((Operator)tokens[split]).Symbol switch { '+' => left + right, '-' => left - right, '*' => left * right, '/' => left / right, var s => throw new FormatException("operator " + s) };
    }

    private static bool Balanced(ReadOnlySpan<Token> tokens)
    {
        int depth = 0;
        foreach (var token in tokens)
        {
            if (token is Paren { Open: var open }) depth += open ? 1 : -1;
            if (depth < 0) return false;
        }
        return depth == 0;
    }

    private static Token[] Lex(string text) => text.Where(c => c != ' ').Select(c => c switch
    {
        >= '0' and <= '9' => new Number(c - '0'),
        '(' or ')' => new Paren(c == '('),
        '+' or '-' or '*' or '/' => (Token)new Operator(c),
        _ => throw new FormatException("character " + c),
    }).ToArray();

    private static string Classify(Line line) => line switch
    {
        { From: var a, To: var b } when a == b => "point",
        { From.X: var x1, To.X: var x2 } when x1 == x2 => "vertical",
        { From.Y: var y, To: { Y: var y2 } } when y == y2 => "horizontal",
        { From: (0, 0), To: (var x, var y) } when x == y => "diagonal from origin",
        ({ X: < 0 } or { Y: < 0 }, _) => "starts outside",
        (_, { X: > 0, Y: > 0 } end) and var whole => "to quadrant I, length² " + ((end.X - whole.From.X) * (end.X - whole.From.X) + (end.Y - whole.From.Y) * (end.Y - whole.From.Y)),
        _ => "general",
    };

    private static string Describe(object value) => value switch
    {
        int and (< 0 or > 100) => "extreme int",
        int n and not 0 when n % 2 == 0 => "even",
        int => "odd or zero",
        string { Length: >= 3 } s and not "skip" when s[0] is >= 'a' and <= 'z' => "lower word",
        string s when s is ['#', ..] => "tag",
        string s when s is [.., '!'] => "shout",
        string => "text",
        (int a, int b) and not (0, 0) => "pair " + (a > b ? "desc" : "asc"),
        ValueTuple<int, int> => "origin",
        IList<int> { Count: 0 } => "empty list",
        IList<int> and [var only] => "singleton " + only,
        IList<int> list when list is [.., var last] => "list ending " + last,
        not null => "something",
        null => "nothing",
    };

    public static void Main()
    {
        int[][] samples = { new int[0], new[] { 7 }, new[] { 0, 5, 0 }, new[] { 3, 4 }, new[] { 1, 2, 3, 4, 5 }, new[] { 5, 5, -1 }, new[] { 500, 1, 2 }, new[] { 9, 9, 9 }, new[] { 2, 1, 1, 1, 1, 8 }, new[] { 2, 3, 4, 5 } };
        Console.WriteLine(string.Join("; ", samples.Select(Shape)));
        foreach (var text in new[] { "1+2*3", "(1+2)*3", "-(4-6)*2", "8/4/2", "2*(3+(4-1))*2", "((7))", "9-1-2-3", "1+", "()", "2 $ 3" })
        {
            try { Console.Write(text + "=" + Evaluate(Lex(text)) + "  "); }
            catch (FormatException e) { Console.Write(text + " -> " + e.Message + "  "); }
        }
        Console.WriteLine();
        var lines = new[]
        {
            new Line(new(1, 1), new(1, 1)), new Line(new(2, 0), new(2, 9)), new Line(new(0, 3), new(5, 3)), new Line(new(0, 0), new(4, 4)),
            new Line(new(-1, 2), new(3, 5)), new Line(new(1, 2), new(4, 6)), new Line(new(1, 2), new(-4, 6)),
        };
        Console.WriteLine(string.Join("; ", lines.Select(Classify)));
        object[] values = { -5, 4, 7, 0, 101, "hello", "skip", "#tag", "Hey!", "Ab", (2, 1), (1, 2), (0, 0), new List<int>(), new[] { 3 }, new List<int> { 1, 2, 9 }, 2.5, null };
        Console.WriteLine(string.Join("; ", values.Select(Describe)));
        string text2 = "hello world";
        Console.WriteLine((text2 is ['h', .., 'd']) + " " + (text2 is [_, 'e', .. var middle, _] ? middle : "?") + " " + (text2.AsSpan() is [.., 'l', 'd']) + " " + (new List<string> { "a", "b" } is ["a", { Length: 1 } second] && second == "b") + " " + (samples[4] is [_, .. [2, .., 4], _]));
        if (samples[8] is [var a, .. var mid, var z] && mid is [1, .. { Length: var ones }]) Console.WriteLine(a + z + " " + mid.Length + " " + ones);
        int count = 0;
        foreach (var sample in samples) if (sample is { Length: > 2 } and [.., > 0] and not [0, ..]) count++;
        Console.WriteLine(count + " " + (count is > 2 and < 10 ? "some" : "few") + " " + (values[17] is not { }) + " " + (values[0] is int and < 0 and var negative ? negative * 2 : 0));
    }
}
