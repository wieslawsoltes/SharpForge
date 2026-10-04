using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

var tracks = new List<Track>
{
    new Track("track10", "Zoe", 187, 4.5, new Version(1, 10)),
    new Track("Track2", "adam", 245, 3.0, new Version(1, 2)),
    new Track("track1", "Élan", 187, 4.5, new Version(2, 0)),
    new Track("TRACK12", "Bob", 320, 5.0, new Version(1, 2, 3)),
    new Track("track02", "adam", 95, 3.0, null),
    new Track("intro", "Zoe", 30, 1.5, new Version(0, 9)),
};

string Names(IEnumerable<Track> source) => string.Join(" ", source.Select(t => t.Title));
int comparisons = 0;

Console.WriteLine("-- ordinal vs ignore-case vs natural");
Console.WriteLine(Names(tracks.OrderBy(t => t.Title, StringComparer.Ordinal)));
Console.WriteLine(Names(tracks.OrderBy(t => t.Title, StringComparer.OrdinalIgnoreCase)));
Console.WriteLine(Names(tracks.OrderBy(t => t.Title, new NaturalComparer())));
Console.WriteLine(Names(tracks.OrderByDescending(t => t.Title, new NaturalComparer())));

Console.WriteLine("-- ThenBy chains");
Console.WriteLine(Names(tracks.OrderBy(t => t.Seconds).ThenBy(t => t.Title, StringComparer.Ordinal)));
Console.WriteLine(Names(tracks.OrderByDescending(t => t.Rating).ThenBy(t => t.Seconds).ThenByDescending(t => t.Title, StringComparer.Ordinal)));
Console.WriteLine(Names(tracks.OrderBy(t => t.Artist, StringComparer.OrdinalIgnoreCase).ThenByDescending(t => t.Seconds)));
var byLengthThenReverse = Comparer<string>.Create((a, b) => { comparisons++; return a.Length != b.Length ? a.Length - b.Length : string.CompareOrdinal(b, a); });
Console.WriteLine(Names(tracks.OrderBy(t => t.Title, byLengthThenReverse)) + " comparisons>0: " + (comparisons > 0));

Console.WriteLine("-- stability: equal keys keep source order");
Console.WriteLine(Names(tracks.OrderBy(t => t.Rating)));
Console.WriteLine(Names(tracks.OrderBy(t => 0)));
Console.WriteLine(Names(tracks.AsEnumerable().Reverse().OrderBy(t => t.Seconds / 100)));

Console.WriteLine("-- null keys and nullable keys");
var nullsLast = Comparer<Version>.Create((a, b) => a is null ? (b is null ? 0 : 1) : b is null ? -1 : a.CompareTo(b));
Console.WriteLine(string.Join(" ", tracks.OrderBy(t => t.Release).Select(t => t.Release?.ToString() ?? "null")));
Console.WriteLine(string.Join(" ", tracks.OrderBy(t => t.Release, nullsLast).Select(t => t.Release?.ToString() ?? "null")));
int?[] ranks = { 3, null, 1, null, 2 };
Console.WriteLine(string.Join(" ", ranks.OrderBy(r => r).Select(r => r?.ToString(CultureInfo.InvariantCulture) ?? "-")) + " | " + string.Join(" ", ranks.OrderByDescending(r => r ?? int.MinValue).Select(r => r.HasValue ? r.Value.ToString(CultureInfo.InvariantCulture) : "-")));

Console.WriteLine("-- comparer composition");
IComparer<Track> composed = TrackOrder.By(t => t.Artist, StringComparer.OrdinalIgnoreCase).Then(TrackOrder.By(t => -t.Seconds, Comparer<int>.Default));
var sorted = tracks.ToArray();
Array.Sort(sorted, composed);
Console.WriteLine(Names(sorted));
Console.WriteLine(Names(tracks.Order(composed)) + " | " + Names(tracks.OrderDescending(composed).Take(2)));
Console.WriteLine(Names(tracks.OrderBy(t => t, new Reversed<Track>(composed))));
Console.WriteLine(string.Join(" ", new[] { 5, 3, 9, 1 }.Order()) + " | " + string.Join(" ", new[] { "b", "C", "a" }.OrderDescending(StringComparer.OrdinalIgnoreCase)) + " | " + string.Join(" ", new[] { 2.5, -1, double.NaN, 0 }.Order().Select(d => d.ToString(CultureInfo.InvariantCulture))));

Console.WriteLine("-- query syntax orderby");
var query = from t in tracks
            where t.Seconds > 50
            orderby t.Rating descending, t.Seconds, t.Title.Length descending
            select $"{t.Title}:{t.Rating.ToString("F1", CultureInfo.InvariantCulture)}/{t.Seconds}";
Console.WriteLine(string.Join(" ", query));
var tuples = from t in tracks
             let key = (Bucket: t.Seconds / 100, Stars: (int)t.Rating)
             orderby key descending, t.Seconds
             select key.Bucket + "" + key.Stars + t.Title[^1];
Console.WriteLine(string.Join(" ", tuples));

Console.WriteLine("-- top-N, ranks, median");
Console.WriteLine(Names(tracks.OrderByDescending(t => t.Seconds).Take(3)) + " | " + Names(tracks.OrderBy(t => t.Seconds).Skip(4)) + " | " + tracks.OrderBy(t => t.Seconds).ElementAt(tracks.Count / 2).Seconds);
var ranked = tracks.OrderByDescending(t => t.Rating).Select((t, i) => (t, i)).GroupBy(x => x.t.Rating).SelectMany(g => g.Select(x => $"#{g.Min(y => y.i) + 1} {x.t.Title}"));
Console.WriteLine(string.Join(", ", ranked));
Console.WriteLine(tracks.OrderBy(t => t.Title, new NaturalComparer()).First().Title + " " + tracks.OrderBy(t => t.Title, new NaturalComparer()).Last().Title + " " + tracks.MaxBy(t => t.Title, new NaturalComparer()).Title + " " + tracks.Max(composed).Title + " " + tracks.Min(composed).Title);

public sealed record Track(string Title, string Artist, int Seconds, double Rating, Version Release);

// Compares embedded digit runs numerically and everything else case-insensitively: track2 < track10.
public sealed class NaturalComparer : IComparer<string>
{
    public int Compare(string x, string y)
    {
        int i = 0, j = 0;
        while (i < x.Length && j < y.Length)
        {
            if (char.IsAsciiDigit(x[i]) && char.IsAsciiDigit(y[j]))
            {
                long a = 0, b = 0;
                while (i < x.Length && char.IsAsciiDigit(x[i])) a = a * 10 + (x[i++] - '0');
                while (j < y.Length && char.IsAsciiDigit(y[j])) b = b * 10 + (y[j++] - '0');
                if (a != b) return a < b ? -1 : 1;
                continue;
            }
            int difference = char.ToUpperInvariant(x[i++]) - char.ToUpperInvariant(y[j++]);
            if (difference != 0) return Math.Sign(difference);
        }
        int rest = (x.Length - i) - (y.Length - j);
        return rest != 0 ? Math.Sign(rest) : string.CompareOrdinal(x, y);
    }
}

public sealed class Reversed<T> : IComparer<T>
{
    private readonly IComparer<T> inner;
    public Reversed(IComparer<T> inner) { this.inner = inner; }
    public int Compare(T x, T y) => inner.Compare(y, x);
}

public static class TrackOrder
{
    public static IComparer<Track> By<TKey>(Func<Track, TKey> key, IComparer<TKey> comparer) => Comparer<Track>.Create((a, b) => comparer.Compare(key(a), key(b)));

    public static IComparer<T> Then<T>(this IComparer<T> first, IComparer<T> second) =>
        Comparer<T>.Create((a, b) => first.Compare(a, b) is var result and not 0 ? result : second.Compare(a, b));
}
