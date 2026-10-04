using System;

struct Point { public int X; }
static class Program
{
    static void Main()
    {
        int? value = default;
        Console.WriteLine(value.HasValue);
        Console.WriteLine(value.GetValueOrDefault());
        Console.WriteLine(value.GetValueOrDefault(99));
        Console.WriteLine((object)value == null);
        value = new int?(12);
        Console.WriteLine(value.HasValue);
        Console.WriteLine(value.Value);
        int? copy = (int?)(object)value;
        value = default;
        Console.WriteLine(copy.Value);
        value = new int?(23);
        Console.WriteLine(value.ToString());
        Console.WriteLine(((object)value).GetType().Name);
        copy = (int?)(object)null;
        Console.WriteLine(copy.HasValue);
        Point point = default;
        point.X = 7;
        Point? optional = point;
        point.X = 18;
        optional = (Point?)(object)optional;
        Console.WriteLine(optional.Value.X);
        optional = default;
        Console.WriteLine(optional.GetValueOrDefault().X);
        decimal? amount = new decimal?(new decimal(42));
        Console.WriteLine(amount.Value);
    }
}
