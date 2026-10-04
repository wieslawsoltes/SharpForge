using System;
using System.Collections.Generic;
using System.Globalization;

// Reduced from stress-patterns/argument-parser, stress-patterns/discount-rules and stress-records/document-model:
// variables a case guard assigns (`when x is > 0 and var n`, `when f(out var v)`) are assigned in the section, and a
// relational or constant pattern narrows a nullable input for the pattern after `and` (also over `decimal`).
public sealed class Coupon
{
    public string Code;
    public decimal? Percent;
    public int? Uses;
}

public static class Program
{
    private static string Parse(string argument, Dictionary<string, int> known)
    {
        switch (argument)
        {
            case { Length: > 2 } text when text.IndexOf('=') is > 0 and var split:
                string key = text.Substring(0, split), value = text.Substring(split + 1);
                return key + "->" + value;
            case var name when known.TryGetValue(name, out int found) && found is var copy:
                return name + "#" + (found + copy);
            case var other when other.Length is var length and > 1:
                return other + ":" + length;
            default:
                return "?";
        }
    }

    private static string Describe(Coupon coupon)
    {
        switch (coupon)
        {
            case null:
                return "none";
            case { Percent: > 0m and <= 50m and var percent, Code: var code }:
                return code + " -" + percent.ToString("0.#", CultureInfo.InvariantCulture) + "% of 200 = " + (200m * percent / 100m).ToString(CultureInfo.InvariantCulture);
            case { Uses: >= 1 and var uses } when uses * 2 is var doubled:
                return "uses " + uses + "/" + doubled;
            case { Percent: not null and var raw }:
                return "raw " + raw.Value.ToString(CultureInfo.InvariantCulture);
            default:
                return "plain";
        }
    }

    public static void Main()
    {
        var known = new Dictionary<string, int> { ["jobs"] = 4 };
        foreach (string argument in new[] { "key=value", "jobs", "xy", "z", "=x" }) Console.WriteLine(Parse(argument, known));
        Console.WriteLine(Describe(null) + " | " + Describe(new Coupon { Code = "TEN", Percent = 10.5m }) + " | " + Describe(new Coupon { Uses = 3 }));
        Console.WriteLine(Describe(new Coupon { Percent = 75m }) + " | " + Describe(new Coupon()));
        object boxed = 42;
        if (boxed is int and > 40 and var big) Console.WriteLine("big " + (big + 1));
        int? maybe = 7;
        if (maybe is > 5 and var seven) Console.WriteLine("seven " + (seven + 1) + " " + seven.GetType().Name);
    }
}
