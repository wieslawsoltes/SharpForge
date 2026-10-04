using System;

public enum Level { Low, High }

public static class Program
{
    static string Name(int? value)
    {
        switch (value)
        {
            case 1: return "one";
            case 2: case 3: return "few";
            case null: return "none";
            default: return "many";
        }
    }

    static string Tier(Level? level) => level switch { Level.Low => "low", Level.High => "high", null => "unset", _ => "?" };
    static string Flag(bool? flag) => flag is true ? "yes" : flag is false ? "no" : "unknown";
    static string Letter(char? c) => c is 'a' or 'b' ? "ab" : c is not null and >= 'x' ? "late" : "other";

    public static void Main()
    {
        int?[] maybe = { 1, null };
        int? one = 1, none = null;
        decimal? noMoney = null;
        Console.WriteLine((one is 1) + " " + (none is null) + " " + (one is null) + " " + (none is 1) + " " + (one is not 1) + " " + (none is not 2));
        Console.WriteLine((maybe is [1, _]) + " " + (maybe is [_, null]) + " " + (maybe is [1, null]) + " " + (maybe[0] is 1) + " " + (maybe[1] is null));
        Console.WriteLine(Name(1) + Name(3) + Name(null) + Name(9) + " " + Tier(Level.High) + Tier(null) + Tier(Level.Low) + " " + Flag(true) + Flag(false) + Flag(null));
        Console.WriteLine(Letter('a') + Letter('z') + Letter(null) + Letter('m') + " " + ((long?)5 is 5) + " " + ((double?)1.5 is 1.5) + " " + (noMoney is 0m));
    }
}
