using System;
using System.Collections.Generic;
using System.Linq;

public enum Suit { Clubs, Diamonds, Hearts, Spades }
public readonly record struct Card(int Rank, Suit Suit);
public abstract class Shape { }
public sealed class Circle : Shape { public double Radius; }
public sealed class Rect : Shape { public double Width, Height; }
public sealed class Triangle : Shape { public double A, B, C; }

public static class Program
{
    private static string RankName(int rank) => rank switch
    {
        1 or 14 => "ace",
        11 => "jack",
        12 => "queen",
        13 => "king",
        >= 2 and <= 10 => rank.ToString(),
        _ => throw new ArgumentOutOfRangeException(nameof(rank)),
    };

    private static int Compare(Card left, Card right, Suit trump) => (left, right) switch
    {
        ({ Suit: var a }, { Suit: var b }) when a == trump && b != trump => 1,
        ({ Suit: var a }, { Suit: var b }) when a != trump && b == trump => -1,
        ({ Rank: var x }, { Rank: var y }) when x != y => x.CompareTo(y),
        _ => left.Suit.CompareTo(right.Suit),
    };

    private static string Command(string line)
    {
        string[] parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        switch (parts)
        {
            case []:
                return "empty";
            case ["quit" or "exit"]:
                return "bye";
            case ["add", var x, var y] when int.TryParse(x, out int a) && int.TryParse(y, out int b):
                return (a + b).ToString();
            case ["add", ..]:
                return "usage: add x y";
            case ["echo", .. var rest]:
                return string.Join("_", rest);
            case [var first, .., var last]:
                return first + ".." + last;
            case [var only]:
                switch (only.ToLowerInvariant())
                {
                    case "help":
                    case "?":
                        return "commands";
                    case "version":
                        return "1.0";
                    case var text when text.Length > 6:
                        return "long word";
                    default:
                        return "unknown " + only;
                }
            default:
                return "unreachable";
        }
    }

    private static string Area(Shape shape)
    {
        switch (shape)
        {
            case Circle { Radius: 0 }:
                return "point";
            case Circle c:
                return "circle " + Math.Round(Math.PI * c.Radius * c.Radius, 2);
            case Rect { Width: var w, Height: var h } when w == h:
                return "square " + w * h;
            case Rect r:
                return "rect " + r.Width * r.Height;
            case Triangle { A: var a, B: var b, C: var c } when a + b > c && a + c > b && b + c > a:
                double s = (a + b + c) / 2;
                return "triangle " + Math.Round(Math.Sqrt(s * (s - a) * (s - b) * (s - c)), 2);
            case Triangle:
                return "degenerate";
            case null:
                return "nothing";
            default:
                return "unknown";
        }
    }

    private static string FizzBuzz(int n) => (n % 3, n % 5) switch { (0, 0) => "FizzBuzz", (0, _) => "Fizz", (_, 0) => "Buzz", _ => n.ToString() };

    private static int Days(int month, bool leap)
    {
        switch (month)
        {
            case 2:
                return leap ? 29 : 28;
            case 4: case 6: case 9: case 11:
                return 30;
            case < 1 or > 12:
                return 0;
            default:
                return 31;
        }
    }

    private static string Kind(object value) => value switch
    {
        sbyte or byte or short or ushort or int or uint or long or ulong => "integer",
        float or double or decimal => "real",
        char c when char.IsDigit(c) => "digit char",
        char => "char",
        string { Length: 0 } => "empty string",
        string s when s.All(char.IsUpper) => "upper string",
        string => "string",
        bool b => b ? "yes" : "no",
        Enum e => "enum " + e,
        ValueTuple<int, int>(var x, var y) => "pair " + (x + y),
        Array { Length: var n } => "array of " + n,
        IEnumerable<int> seq => "ints " + seq.Sum(),
        Type t => "type " + t.Name,
        Delegate => "delegate",
        _ => value.GetType().Name,
    };

    public static void Main()
    {
        Console.WriteLine(string.Join(" ", new[] { 1, 5, 10, 11, 12, 13, 14 }.Select(RankName)));
        try { RankName(0); } catch (ArgumentOutOfRangeException e) { Console.WriteLine("bad " + e.ParamName); }
        var hand = new[] { new Card(10, Suit.Hearts), new Card(2, Suit.Spades), new Card(14, Suit.Clubs), new Card(10, Suit.Clubs), new Card(3, Suit.Spades) };
        Array.Sort(hand, (x, y) => Compare(x, y, Suit.Spades));
        Console.WriteLine(string.Join(" ", hand.Select(card => RankName(card.Rank) + card.Suit.ToString()[0])));
        foreach (var line in new[] { "", "quit", "add 2 40", "add 2", "add x y", "echo a b c", "echo", "copy a to b", "help", "?", "VERSION", "something", "run" })
            Console.Write("[" + Command(line) + "] ");
        Console.WriteLine();
        Shape[] shapes = { new Circle { Radius = 1 }, new Circle(), new Rect { Width = 2, Height = 2 }, new Rect { Width = 2, Height = 3 }, new Triangle { A = 3, B = 4, C = 5 }, new Triangle { A = 1, B = 1, C = 5 }, null };
        Console.WriteLine(string.Join(", ", shapes.Select(Area)));
        Console.WriteLine(string.Join(" ", Enumerable.Range(1, 15).Select(FizzBuzz)));
        Console.WriteLine(string.Join(" ", Enumerable.Range(0, 14).Select(month => Days(month, month % 2 == 0))));
        object[] values = { 1, 2u, (byte)3, 4L, 1.5, 2.5f, 3m, '7', 'x', "", "ABC", "abc", true, Suit.Hearts, (1, 2), new[] { "a" }, new List<int> { 1, 2 }, typeof(string), (Action)(() => { }), new object(), 1.5f };
        Console.WriteLine(string.Join("; ", values.Select(Kind)));
    }
}
