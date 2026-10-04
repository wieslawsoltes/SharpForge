using System;

// Reduced from stress-patterns/message-decoder and stress-language/tuple-alias-raw-strings: property patterns over
// the element names of a tuple (`{ X: var dx }`, `Delta.X: > 0`), next to positional and list patterns in properties;
// and a tuple compared with `default`.
public sealed class Text { public int Channel; public string Body; }
public sealed class Move { public (int X, int Y) Delta; }

public static class Program
{
    static string A(object o) => o switch { Text { Body: ['/', .. var command] } text => "cmd " + command + text.Channel, _ => "-" };
    static string B(object o) => o switch { Text { Body.Length: > 3, Body: var body } => "long " + body, _ => "-" };
    static string C(object o) => o switch { Move { Delta: (0, 0) } => "none", Move { Delta: (var dx, 0) } => "h" + dx, _ => "-" };
    static string D(object o) => o switch { Move { Delta: { X: var dx, Y: var dy } } when dx == dy => "diag" + dx, _ => "-" };
    static string E(object o) => o switch { Move { Delta.X: > 0, Delta.Y: var dy } move => "east" + move.Delta.X + dy, _ => "-" };
    static string F((int X, int Y) p) => p switch { { X: 0 } => "x0", { Y: var y } => "y" + y };
    static string G((string Name, int Age) p) => p is { Name: "a", Age: > 3 } ? "match" : p is (var n, _) ? n : "-";

    public static void Main()
    {
        Console.WriteLine(A(new Text { Body = "/go", Channel = 2 }) + " " + B(new Text { Body = "hello" }));
        Console.WriteLine(C(new Move()) + " " + C(new Move { Delta = (4, 0) }) + " " + D(new Move { Delta = (3, 3) }) + " " + E(new Move { Delta = (2, 9) }));
        Console.WriteLine(F((0, 1)) + " " + F((2, 7)) + " " + G(("a", 5)) + " " + G(("b", 1)));
        (int Row, int Column) best = default;
        bool first = best == default, second = default != best;
        best = (1, 2);
        Console.WriteLine(first + " " + second + " " + (best == default) + " " + (best != default));
    }
}
