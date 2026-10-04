using System;
using System.Collections.Generic;

public enum State { Created, Paid, Shipped }
public readonly record struct Point(int X, int Y);

public static class Program
{
    // The arms have no common type (`null` does not convert to State): the switch takes the target type State?.
    static State? Next(State state, int trigger) => (state, trigger) switch
    {
        (State.Created, 1) => State.Paid,
        (State.Paid, 2) => State.Shipped,
        _ => null,
    };

    static string Age(int? value) => value switch
    {
        null => "unknown",
        < 18 => "minor",
        >= 18 and < 65 => "adult " + value.Value,
        var v => "senior " + v,
    };

    static string Fire(State state, int trigger)
    {
        State? target = Next(state, trigger);
        if (target is not { } next) return "ignored";
        State copy = next;
        return state + "->" + copy;
    }

    static (int Cost, List<string> Path)? Route(bool found) => found ? (7, new List<string> { "a", "b" }) : null;

    static string Show(Point? point) => point switch
    {
        { X: 0, Y: 0 } => "origin",
        (var x, 0) => "on x at " + x,
        { } p when p.X == p.Y => "diagonal " + p,
        Point p => "point " + p.X + "," + p.Y,
        null => "nothing",
    };

    static string Narrow(object value) =>
        value is int and < 0 and var negative ? "negative " + negative * 2
        : value is string { Length: > 2 } and var text ? "text " + text.ToUpperInvariant()
        : "other";

    static double Ratio(double value) => value is var d && d == 0 ? double.NaN : 1 / d;

    public static void Main()
    {
        Console.WriteLine(Next(State.Created, 1) + "|" + Next(State.Shipped, 1) + "|" + Fire(State.Created, 1) + "|" + Fire(State.Paid, 2) + "|" + Fire(State.Paid, 1));
        Console.WriteLine(Age(null) + " " + Age(5) + " " + Age(30) + " " + Age(70));
        foreach (bool found in new[] { true, false })
        {
            var route = Route(found);
            Console.WriteLine(route is var (cost, path) ? cost + " via " + string.Join(">", path) : "unreachable");
            Console.WriteLine(route is (> 5, { Count: 2 }) ? "long" : "short or none");
        }
        Console.WriteLine(Show(new Point(0, 0)) + "; " + Show(new Point(3, 0)) + "; " + Show(new Point(2, 2)) + "; " + Show(new Point(1, 2)) + "; " + Show(null));
        Console.WriteLine(Narrow(-4) + "; " + Narrow(4) + "; " + Narrow("abc") + "; " + Narrow("ab") + "; " + Ratio(4) + " " + Ratio(0));
        int? maybe = 3, none = null;
        Console.WriteLine((maybe is int and > 2) + " " + (maybe is { } value ? value + 1 : -1) + " " + (maybe is not null and not 4) + " " + (none is { }) + " " + (none is > 2 or null));
    }
}
