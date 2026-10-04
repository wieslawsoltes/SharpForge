using System;
using System.Collections.Generic;
using System.Linq;

public sealed class Range3
{
    public Range3(int low, int mid, int high) { Low = low; Mid = mid; High = high; }
    public int Low { get; }
    public int Mid { get; }
    public int High { get; }
    public void Deconstruct(out int low, out int high) { low = Low; high = High; }
    public void Deconstruct(out int low, out int mid, out int high) { low = Low; mid = Mid; high = High; }
}

public static class Extensions
{
    public static void Deconstruct<TKey, TValue>(this KeyValuePair<TKey, List<TValue>> pair, out TKey key, out int count, out TValue first)
    {
        key = pair.Key;
        count = pair.Value.Count;
        first = pair.Value.FirstOrDefault();
    }

    public static void Deconstruct(this DateTime date, out int year, out int month, out int day) { year = date.Year; month = date.Month; day = date.Day; }

    public static (T Min, T Max) MinMax<T>(this IEnumerable<T> source) where T : IComparable<T>
    {
        using var e = source.GetEnumerator();
        if (!e.MoveNext()) throw new InvalidOperationException("empty");
        T min = e.Current, max = e.Current;
        while (e.MoveNext())
        {
            if (e.Current.CompareTo(min) < 0) min = e.Current;
            if (e.Current.CompareTo(max) > 0) max = e.Current;
        }
        return (min, max);
    }

    public static (TResult First, TResult Second) Map<T, TResult>(this (T, T) pair, Func<T, TResult> map) => (map(pair.Item1), map(pair.Item2));
    public static IEnumerable<(int Index, T Item)> Indexed<T>(this IEnumerable<T> source) => source.Select((item, index) => (index, item));
}

public static class Program
{
    private static (int Quotient, int Remainder) Divide(int a, int b) => (a / b, a % b);
    private static (string Name, (int X, int Y) Position, string[] Tags) Describe(int id) => ("node" + id, (id * 2, id * 3), new[] { "t" + id });
    private static T Second<T>((T, T) pair) => pair.Item2;
    private static (T2, T1) Flip<T1, T2>((T1, T2) pair) => (pair.Item2, pair.Item1);
    private static (int Count, double Mean, T Last) Stats<T>(IReadOnlyList<T> items, Func<T, double> measure) => (items.Count, items.Average(measure), items[items.Count - 1]);
    private static (int, int, int, int, int, int, int, int, int) Nine() => (1, 2, 3, 4, 5, 6, 7, 8, 9);

    public static void Main()
    {
        var (q, r) = Divide(17, 5);
        (int quotient, int remainder) = Divide(-17, 5);
        var division = Divide(100, 7);
        Console.WriteLine($"{q} {r} {quotient} {remainder} {division.Quotient} {division.Remainder} {division} {division.Item1 == division.Quotient}");

        var (name, (x, y), tags) = Describe(4);
        var description = Describe(5);
        Console.WriteLine(name + x + y + tags[0] + " " + description.Position.Y + " " + description.Tags.Length + " " + description.Position);

        int a = 1, b = 2, c = 3;
        (a, b, c) = (c, a, b);
        (a, b) = (b, a + b);
        int[] array = { 10, 20, 30 };
        (array[0], array[2]) = (array[2], array[0]);
        string s; int n;
        (s, n) = ("text", s_length("text"));
        Console.WriteLine($"{a}{b}{c} {string.Join(",", array)} {s}{n}");

        var range = new Range3(1, 5, 9);
        var (low, high) = range;
        var (l2, mid, h2) = range;
        (int first, _, int third) = range;
        var (year, month, _) = new DateTime(2024, 3, 15);
        Console.WriteLine(low + high + " " + l2 + mid + h2 + " " + first + third + " " + year + "/" + month);

        var groups = new Dictionary<string, List<double>> { ["a"] = new List<double> { 1.5, 2 }, ["b"] = new List<double>() };
        foreach (var (key, count, head) in groups) Console.Write($"{key}:{count}:{head} ");
        foreach (var (index, item) in new[] { "x", "y", "z" }.Indexed().Where(pair => pair.Index != 1)) Console.Write(index + item + " ");
        Console.WriteLine();

        var (min, max) = new[] { 3, 9, -2, 7 }.MinMax();
        var words = new[] { "pear", "fig", "banana" }.MinMax();
        Console.WriteLine(min + " " + max + " " + words + " " + words.Min.Length + " " + (1.5, 2.5).Map(v => (int)(v * 2)) + " " + ("a", "b").Map(string.IsNullOrEmpty).Second);
        Console.WriteLine(Second((1, 2)) + " " + Second(("a", "b")) + " " + Flip((1, "one")) + " " + Flip(Flip((2.5, 'c'))) + " " + Stats(new[] { "aa", "b", "cccc" }, w => w.Length));

        var t1 = (1, "a");
        (int Id, string Text) t2 = t1;
        (long, object) widened = t1;
        (int Id, string Text)? optional = null;
        var equal = t1 == t2 && t2 == (1, "a") && (1, (2, 3)) == (1, (2, 3)) && t1 != (2, "a");
        optional = (5, "five");
        Console.WriteLine(equal + " " + t2.Text + widened.Item1 + " " + (optional?.Id ?? -1) + " " + t1.Equals(t2) + " " + (t1.GetHashCode() == t2.GetHashCode()) + " " + t1.CompareTo((1, "b")) + " " + t1.ToString());
        var nine = Nine();
        var (n1, _, _, _, _, _, _, n8, n9) = nine;
        Console.WriteLine(nine.Item9 + nine.Rest.Item1 + n1 + n8 + n9 + " " + nine);
        var lookup = new Dictionary<(string, int), (double Price, bool Stock)> { [("apple", 1)] = (0.5, true), [("pear", 2)] = (0.75, false) };
        var cheapest = lookup.OrderBy(pair => pair.Value.Price).Select(pair => (pair.Key.Item1, pair.Value.Stock)).First();
        var list = new List<(int Id, string Name)> { (2, "b"), (1, "a") };
        list.Sort();
        Console.WriteLine(cheapest + " " + lookup[("pear", 2)].Price + " " + string.Join("", list.Select(item => item.Name)) + " " + list.Max(item => item.Id) + " " + (list[0] is (1, "a")) + " " + (list[1] is (var id, _) && id == 2));
        static int s_length(string text) => text.Length;
    }
}
