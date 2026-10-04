using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

var journal = new List<string>();
var readings = new Feed<Reading>(journal, new[]
{
    new Reading("north", 3, 12.5), new Reading("south", 1, 30.0), new Reading("north", 2, -4.0),
    new Reading("east", 5, 21.25), new Reading("south", 4, 18.0), new Reading("east", 6, double.NaN),
});
var limits = new Feed<Limit>(journal, new[] { new Limit("north", 10), new Limit("south", 25), new Limit("west", 0) });

void Dump<T>(string title, Feed<T> feed)
{
    Console.WriteLine(title + ": " + string.Join(" ", feed.Items));
    Console.WriteLine("   calls: " + string.Join(">", journal));
    journal.Clear();
}

// The compiler binds every clause to the Feed<T> methods below, not to System.Linq.
Dump("where only (no Select call)", from r in readings where r.Hour > 3 select r);
Dump("where + projection", from r in readings where r.Station != "east" select r.Station[0] + ":" + r.Hour);
Dump("identity select", from r in readings select r);
Dump("let", from r in readings
            let fahrenheit = r.Celsius * 9 / 5 + 32
            where fahrenheit > 60
            select r.Station + "=" + fahrenheit.ToString("F1", CultureInfo.InvariantCulture));
Dump("two lets", from r in readings
                 let valid = !double.IsNaN(r.Celsius)
                 let rounded = valid ? (int)Math.Round(r.Celsius) : -999
                 where valid
                 select rounded.ToString("+00;-00", CultureInfo.InvariantCulture));
Dump("orderby", from r in readings orderby r.Hour descending select r.Hour);
Dump("orderby two keys", from r in readings orderby r.Station.Length, r.Hour descending select r.Station[0].ToString() + r.Hour);
Dump("multiple from", from r in readings
                      from l in limits
                      where r.Station == l.Station && r.Celsius > l.Max
                      select r.Station + "@" + r.Hour);
Dump("from + trailing select", from r in readings from l in limits select r.Hour * l.Max);
Dump("join", from r in readings join l in limits on r.Station equals l.Station select r.Hour + "/" + l.Max);
Dump("join into", from l in limits
                  join r in readings on l.Station equals r.Station into hits
                  select l.Station + "#" + hits.Count());
Dump("group by", from r in readings group r.Hour by r.Station);
Dump("group into + continuation", from r in readings
                                  where !double.IsNaN(r.Celsius)
                                  group r by r.Station into g
                                  where g.Values.Count > 1
                                  select g.Key + ":" + g.Values.Sum(v => v.Celsius).ToString("F2", CultureInfo.InvariantCulture));
Dump("select into", from r in readings
                    select r.Hour * 2 into doubled
                    where doubled % 4 == 0
                    select doubled + 1);
Dump("typed range variable", from object boxed in new Feed<int>(journal, new[] { 1, 2, 3 }) select boxed.GetType() == typeof(int));

Maybe<int> ParseHour(string text) => int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out int hour) && hour < 24 ? Maybe<int>.Some(hour) : Maybe<int>.None;
foreach (var (from, to) in new[] { ("9", "17"), ("9", "x"), ("25", "3"), ("22", "6") })
{
    Maybe<string> shift = from start in ParseHour(@from)
                          from end in ParseHour(to)
                          let length = (end - start + 24) % 24
                          where length <= 8
                          select $"{start:D2}-{end:D2} ({length}h)";
    Console.WriteLine($"shift {@from}..{to}: {shift}");
}

public sealed record Reading(string Station, int Hour, double Celsius)
{
    public override string ToString() => Station[0] + Hour.ToString(CultureInfo.InvariantCulture);
}

public sealed record Limit(string Station, int Max);

public sealed class Bucket<TKey, TValue>
{
    public Bucket(TKey key, List<TValue> values) { Key = key; Values = values; }
    public TKey Key { get; }
    public List<TValue> Values { get; }
    public override string ToString() => Key + "[" + string.Join(",", Values) + "]";
}

// Implements the C# query pattern by hand and journals which operator each clause turned into.
public sealed class Feed<T>
{
    private readonly List<string> journal;
    public Feed(List<string> journal, IEnumerable<T> items) { this.journal = journal; Items = items.ToList(); }
    public List<T> Items { get; }
    private Feed<TResult> Next<TResult>(string call, IEnumerable<TResult> items) { journal.Add(call); return new Feed<TResult>(journal, items); }

    public Feed<T> Where(Func<T, bool> predicate) => Next("Where", Items.Where(predicate));
    public Feed<TResult> Select<TResult>(Func<T, TResult> selector) => Next("Select", Items.Select(selector));
    public Feed<TResult> Cast<TResult>() => Next("Cast", Items.Cast<TResult>());
    public Feed<TResult> SelectMany<TOther, TResult>(Func<T, Feed<TOther>> other, Func<T, TOther, TResult> result) =>
        Next("SelectMany", Items.SelectMany(item => other(item).Items, result));
    public Feed<TResult> Join<TInner, TKey, TResult>(Feed<TInner> inner, Func<T, TKey> outerKey, Func<TInner, TKey> innerKey, Func<T, TInner, TResult> result) =>
        Next("Join", Items.Join(inner.Items, outerKey, innerKey, result));
    public Feed<TResult> GroupJoin<TInner, TKey, TResult>(Feed<TInner> inner, Func<T, TKey> outerKey, Func<TInner, TKey> innerKey, Func<T, IEnumerable<TInner>, TResult> result) =>
        Next("GroupJoin", Items.GroupJoin(inner.Items, outerKey, innerKey, result));
    public Feed<Bucket<TKey, T>> GroupBy<TKey>(Func<T, TKey> key) => Next("GroupBy", Items.GroupBy(key).Select(g => new Bucket<TKey, T>(g.Key, g.ToList())));
    public Feed<Bucket<TKey, TElement>> GroupBy<TKey, TElement>(Func<T, TKey> key, Func<T, TElement> element) =>
        Next("GroupBy2", Items.GroupBy(key, element).Select(g => new Bucket<TKey, TElement>(g.Key, g.ToList())));
    public SortedFeed<T> OrderBy<TKey>(Func<T, TKey> key) { journal.Add("OrderBy"); return new SortedFeed<T>(journal, Items.OrderBy(key)); }
    public SortedFeed<T> OrderByDescending<TKey>(Func<T, TKey> key) { journal.Add("OrderByDescending"); return new SortedFeed<T>(journal, Items.OrderByDescending(key)); }
}

public sealed class SortedFeed<T>
{
    private readonly List<string> journal;
    private readonly IOrderedEnumerable<T> ordered;
    public SortedFeed(List<string> journal, IOrderedEnumerable<T> ordered) { this.journal = journal; this.ordered = ordered; }
    public SortedFeed<T> ThenBy<TKey>(Func<T, TKey> key) { journal.Add("ThenBy"); return new SortedFeed<T>(journal, ordered.ThenBy(key)); }
    public SortedFeed<T> ThenByDescending<TKey>(Func<T, TKey> key) { journal.Add("ThenByDescending"); return new SortedFeed<T>(journal, ordered.ThenByDescending(key)); }
    public Feed<TResult> Select<TResult>(Func<T, TResult> selector) { journal.Add("Select"); return new Feed<TResult>(journal, ordered.Select(selector)); }
}

public readonly struct Maybe<T>
{
    private readonly T value;
    private readonly bool hasValue;
    private Maybe(T value) { this.value = value; hasValue = true; }
    public static Maybe<T> Some(T value) => new Maybe<T>(value);
    public static Maybe<T> None => default;
    public Maybe<TResult> Select<TResult>(Func<T, TResult> selector) => hasValue ? Maybe<TResult>.Some(selector(value)) : Maybe<TResult>.None;
    public Maybe<T> Where(Func<T, bool> predicate) => hasValue && predicate(value) ? this : None;
    public Maybe<TResult> SelectMany<TOther, TResult>(Func<T, Maybe<TOther>> bind, Func<T, TOther, TResult> project)
    {
        if (!hasValue) return Maybe<TResult>.None;
        Maybe<TOther> other = bind(value);
        return other.hasValue ? Maybe<TResult>.Some(project(value, other.value)) : Maybe<TResult>.None;
    }
    public override string ToString() => hasValue ? "Some(" + value + ")" : "None";
}
