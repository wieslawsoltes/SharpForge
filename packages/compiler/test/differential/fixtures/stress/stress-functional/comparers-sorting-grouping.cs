using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

public sealed class Version3 : IComparable<Version3>, IComparable, IEquatable<Version3>
{
    public Version3(int major, int minor, int patch) { Major = major; Minor = minor; Patch = patch; }
    public int Major { get; }
    public int Minor { get; }
    public int Patch { get; }

    public int CompareTo(Version3 other)
    {
        if (other is null) return 1;
        int result = Major.CompareTo(other.Major);
        if (result != 0) return result;
        result = Minor.CompareTo(other.Minor);
        return result != 0 ? result : Patch.CompareTo(other.Patch);
    }

    int IComparable.CompareTo(object obj) => obj is Version3 other ? CompareTo(other) : throw new ArgumentException("not a version");
    public bool Equals(Version3 other) => other is not null && Major == other.Major && Minor == other.Minor && Patch == other.Patch;
    public override bool Equals(object obj) => Equals(obj as Version3);
    public override int GetHashCode() => Major * 10000 + Minor * 100 + Patch;
    public override string ToString() => $"{Major}.{Minor}.{Patch}";
    public static bool operator <(Version3 a, Version3 b) => a.CompareTo(b) < 0;
    public static bool operator >(Version3 a, Version3 b) => a.CompareTo(b) > 0;
    public static bool operator ==(Version3 a, Version3 b) => a is null ? b is null : a.Equals(b);
    public static bool operator !=(Version3 a, Version3 b) => !(a == b);
}

public sealed class CaseInsensitiveComparer : IEqualityComparer<string>
{
    public int Calls;
    public bool Equals(string x, string y) { Calls++; return string.Equals(x, y, StringComparison.OrdinalIgnoreCase); }
    public int GetHashCode(string obj) => obj.ToUpperInvariant().Length;
}

public sealed class LengthThenOrdinal : IComparer<string>
{
    public int Compare(string x, string y)
    {
        int byLength = x.Length - y.Length;
        return byLength != 0 ? byLength : string.CompareOrdinal(x, y);
    }
}

public readonly struct Point : IEquatable<Point>
{
    public Point(int x, int y) { X = x; Y = y; }
    public int X { get; }
    public int Y { get; }
    public bool Equals(Point other) => X == other.X && Y == other.Y;
    public override bool Equals(object obj) => obj is Point p && Equals(p);
    public override int GetHashCode() => X * 31 + Y;
    public override string ToString() => $"({X},{Y})";
}

public sealed class Ring<T> : IEnumerable<T>
{
    private readonly T[] items;
    private readonly int start;
    public Ring(T[] items, int start) { this.items = items; this.start = start; }
    public IEnumerator<T> GetEnumerator()
    {
        for (int i = 0; i < items.Length; i++) yield return items[(start + i) % items.Length];
    }
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

public static class Program
{
    public static void Main()
    {
        var versions = new List<Version3> { new Version3(1, 10, 0), new Version3(1, 2, 3), new Version3(0, 9, 9), new Version3(1, 2, 3), new Version3(2, 0, 0) };
        versions.Sort();
        Console.WriteLine(string.Join(" < ", versions));
        versions.Sort((a, b) => b.CompareTo(a));
        Console.WriteLine(string.Join(" ", versions) + " max=" + versions.Max() + " distinct=" + versions.Distinct().Count());
        Console.WriteLine((versions[0] > versions[1]) + " " + (versions[2] == versions[3]) + " " + (versions[2] != versions[3]) + " " + ReferenceEquals(versions[2], versions[3]));
        Console.WriteLine(versions.BinarySearch(new Version3(1, 2, 3), Comparer<Version3>.Create((a, b) => b.CompareTo(a))) >= 0);

        var comparer = new CaseInsensitiveComparer();
        var set = new HashSet<string>(comparer) { "Apple", "apple", "APPLE", "pear", "Pear", "fig" };
        Console.WriteLine(set.Count + " " + set.Contains("FIG") + " " + (comparer.Calls > 0));
        var counts = new Dictionary<string, int>(comparer);
        foreach (var word in "the quick The lazy QUICK the dog".Split(' '))
        {
            counts.TryGetValue(word, out int n);
            counts[word] = n + 1;
        }
        Console.WriteLine(string.Join(", ", counts.OrderByDescending(p => p.Value).ThenBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + "=" + p.Value)));

        string[] words = { "kiwi", "fig", "banana", "apple", "date", "cherry", "plum", "pear" };
        var sorted = (string[])words.Clone();
        Array.Sort(sorted, new LengthThenOrdinal());
        Console.WriteLine(string.Join(" ", sorted));
        Array.Sort(sorted, StringComparer.Ordinal);
        Console.WriteLine(string.Join(" ", sorted) + " @" + Array.BinarySearch(sorted, "fig", StringComparer.Ordinal));

        var groups = words.GroupBy(w => w.Length).OrderBy(g => g.Key);
        foreach (var g in groups) Console.WriteLine($"{g.Key}: {string.Join(",", g.OrderBy(w => w))} ({g.Count()})");
        var lookup = words.ToLookup(w => w[0]);
        Console.WriteLine(string.Join(";", lookup['p']) + " | " + lookup['z'].Count() + " | " + lookup.Count);

        var sortedSet = new SortedSet<string>(new LengthThenOrdinal()) { "ccc", "a", "bb", "aa", "a" };
        var sortedDictionary = new SortedDictionary<Point, string>(Comparer<Point>.Create((p, q) => p.X != q.X ? p.X.CompareTo(q.X) : q.Y.CompareTo(p.Y)))
        {
            [new Point(1, 1)] = "a", [new Point(0, 5)] = "b", [new Point(1, 9)] = "c",
        };
        Console.WriteLine(string.Join(",", sortedSet) + " " + sortedSet.Min + " " + string.Join("", sortedDictionary.Select(p => p.Key + p.Value)));

        var points = new[] { new Point(1, 2), new Point(3, 4), new Point(1, 2) };
        Console.WriteLine(points.Distinct().Count() + " " + points[0].Equals(points[2]) + " " + points[0].Equals((object)points[1]) + " " + new HashSet<Point>(points).Count + " " + Array.IndexOf(points, new Point(3, 4)));

        var ring = new Ring<int>(new[] { 1, 2, 3, 4, 5 }, 3);
        Console.WriteLine(string.Join("", ring) + " " + ring.Zip(ring.Skip(1), (a, b) => a * b).Sum() + " " + ring.Aggregate((a, b) => a > b ? a : b));
        var joined = from w in words
                     join v in versions.Distinct() on w.Length equals v.Major + 3 into matches
                     from m in matches.DefaultIfEmpty()
                     where m != null
                     orderby w
                     select w + "@" + m;
        Console.WriteLine(string.Join(" ", joined));
        IComparable boxed = new Version3(1, 0, 0);
        try { boxed.CompareTo("text"); } catch (ArgumentException e) { Console.WriteLine(e.Message); }
        Console.WriteLine(Comparer<int>.Default.Compare(3, 7) + " " + EqualityComparer<string>.Default.Equals("a", "a") + " " + StringComparer.OrdinalIgnoreCase.Compare("ABC", "abd"));
    }
}
