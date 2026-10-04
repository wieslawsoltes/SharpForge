using System;
using System.Collections.Generic;
using System.Globalization;

class Program
{
    const int Half = int.MaxValue / 2;
    const double Tau = Math.PI * 2;

    static void Main()
    {
        Console.WriteLine(int.MaxValue);
        Console.WriteLine(long.MinValue);
        Console.WriteLine(uint.MaxValue);
        Console.WriteLine(ulong.MaxValue);
        Console.WriteLine((int)char.MaxValue);
        Console.WriteLine(byte.MaxValue + short.MinValue);
        Console.WriteLine(Half);
        Console.WriteLine(Tau.ToString(CultureInfo.InvariantCulture));
        Console.WriteLine(double.NaN);
        Console.WriteLine(float.MaxValue > 1);
        Console.WriteLine(DayOfWeek.Friday);
        Console.WriteLine((int)DayOfWeek.Friday);
        Console.WriteLine(StringComparison.OrdinalIgnoreCase);
        switch (DateTime.MinValue.DayOfWeek)
        {
            case DayOfWeek.Monday: Console.WriteLine("monday"); break;
            default: Console.WriteLine("other"); break;
        }

        if (int.TryParse("42", out var parsed)) Console.WriteLine(parsed + 1);
        Console.WriteLine(int.TryParse("x", out _));
        Console.WriteLine(double.TryParse("1.5", NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d * 2 : -1);
        Console.WriteLine(long.Parse("9000000000") + 1);
        Console.WriteLine(bool.TryParse("true", out var flag) && flag);
        Console.WriteLine(Enum.TryParse<DayOfWeek>("Sunday", out var day) ? (int)day : -1);

        var ages = new Dictionary<string, int> { ["ann"] = 31, ["bob"] = 27 };
        if (ages.TryGetValue("ann", out var age)) Console.WriteLine(age);
        Console.WriteLine(ages.TryGetValue("zed", out var none) ? none : -1);
        Console.WriteLine(ages.ContainsKey("bob") && !ages.ContainsValue(1));
        ages.Remove("bob");
        Console.WriteLine(ages.Count);
        Console.WriteLine(ages.TryAdd("ann", 1));
        Console.WriteLine(ages.GetValueOrDefault("cy", 5));
    }
}
