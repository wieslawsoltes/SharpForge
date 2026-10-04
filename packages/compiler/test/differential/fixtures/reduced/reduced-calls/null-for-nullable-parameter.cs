using System;
using System.Collections.Generic;
public struct Handle { public int Id { get; set; } }
public class Box<T> { public T Value; public Box(T value) { Value = value; } public bool Has(T other) => EqualityComparer<T>.Default.Equals(Value, other); }
public static class Program
{
    static bool IsDefault<T>(T value) => EqualityComparer<T>.Default.Equals(value, default);
    static string Plain(int? value) => value.HasValue ? "value" : "none";
    static T Pick<T>(bool first, T a, T b) => first ? a : b;
    public static void Main()
    {
        Console.WriteLine(Plain(null));
        Console.WriteLine(IsDefault<int?>(null));
        Console.WriteLine(IsDefault<Handle?>(null));
        Console.WriteLine(IsDefault<string>(null));
        Console.WriteLine(Pick<int?>(true, null, 5).HasValue);
        Console.WriteLine(Pick<int?>(false, null, 5));
        Console.WriteLine(new Box<int?>(null).Has(null));
        Console.WriteLine(new Box<long?>(null).Has(3));
        var list = new List<int?> { 1, null };
        list.Add(null);
        Console.WriteLine(list.Count + " " + list.IndexOf(null) + " " + new Dictionary<string, double?> { ["a"] = null }["a"].HasValue);
        Func<int?, int?, bool> same = (x, y) => x == y;
        Console.WriteLine(same(null, null) + " " + same(1, null));
    }
}
