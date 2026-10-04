using System;
using System.Collections.Generic;
using System.Linq;

// A generic extension method converted to a delegate through its receiver: the type arguments are inferred from the
// receiver (and, for the remaining ones, from the delegate's parameter types).
public static class Extensions
{
    public static string Show<T>(this IEnumerable<T> items) => "[" + string.Join(",", items) + "]";
    public static bool Has<T>(this List<T> items, T value) => items.Contains(value);
    public static TResult Map<T, TResult>(this T value, Func<T, TResult> map) => map(value);
}

public static class Program
{
    public static void Main()
    {
        var numbers = new List<int> { 1, 2, 3 };
        Func<string> show = numbers.Show;
        Func<int, bool> has = numbers.Has;
        Func<int> twice = "ab".Length.ToString().Count<char>;
        Func<Func<string, int>, int> map = "four".Map;
        Console.WriteLine(show() + " " + has(2) + has(5) + " " + twice() + " " + map(text => text.Length));
        Func<string> explicitShow = new[] { 1, 2 }.Show<int>;
        Console.WriteLine(explicitShow());
        Action<string> print = Console.WriteLine;
        print(new[] { 'x', 'y' }.Show());
    }
}
