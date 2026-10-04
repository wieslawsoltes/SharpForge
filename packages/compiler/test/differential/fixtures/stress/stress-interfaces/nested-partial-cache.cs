using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

Boot.Note("main starts");
var cache = new Cache<string, int>(2) { ["a"] = 1, ["bb"] = 2 };
bool hitA = cache.TryGet("a", out int a);
cache["ccc"] = 3;                       // evicts "bb": "a" was touched more recently
bool hitB = cache.TryGet("bb", out int b);
cache["a"] += 10;
cache["dddd"] = 4;                      // evicts "ccc"
Console.WriteLine("lookups: " + hitA + "/" + a + " " + hitB + "/" + b + " a=" + cache["a"] + " count=" + cache.Count + " keys=" + string.Join(",", cache.Select(e => e.Key + "@" + e.Stamp)));
Console.WriteLine("journal: " + string.Join(" ", cache.Journal.Select(j => j.Outcome.ToString()[0] + ":" + j.Entry)));
Console.WriteLine("evictions: " + string.Join(",", cache.EvictedKeys) + " audits=" + cache.AuditCalls + " clock=" + cache.Clock + " stats=" + cache.Stats);

cache.Capacity = 1;                     // partial property setter trims the cache
Console.WriteLine("shrunk: capacity=" + cache.Capacity + " keys=" + string.Join(",", cache.Select(e => e.Key)) + " evictions=" + string.Join(",", cache.EvictedKeys) + " flags=" + cache.State + " " + (int)cache.State);
try { cache.Capacity = 0; } catch (ArgumentOutOfRangeException e) { Console.WriteLine("rejected: " + e.ParamName + " capacity still " + cache.Capacity); }
try { Console.WriteLine(cache["zz"]); } catch (KeyNotFoundException) { Console.WriteLine("indexer miss throws; journal tail=" + cache.Journal[^1].Outcome); }

var byLength = cache.Track(key => key.Length > 2 ? Size.Long : Size.Short);
var byInitial = cache.Track(key => key[0]);
Console.WriteLine("trackers: " + byLength.Summary() + " | " + byInitial.Summary() + " | hits by tag: " + byLength.Count(Size.Short, Cache<string, int>.Outcome.Hit) + "," + byLength.Count(Size.Long, Cache<string, int>.Outcome.Hit));

var numbers = new Cache<int, string>(3);
foreach (int n in new[] { 5, 3, 8, 3, 9, 1 }) numbers[n] = new string('#', n);
using (var third = new Cache<int, string>(1)) third[1] = "x";
Console.WriteLine("numbers: " + string.Join(" ", numbers.OrderBy(e => e.Key).Select(e => e.ToString())) + " evicted=" + string.Join(",", numbers.EvictedKeys) + " instances=" + Cache<string, int>.Instances + "/" + Cache<int, string>.Instances
    + "/" + Cache<int, int>.Instances + " disposed=" + Cache<int, string>.DisposedCount);

// Each closed generic type has its own nested types and its own statics.
Type entryA = typeof(Cache<string, int>.Entry), entryB = typeof(Cache<int, string>.Entry), tracker = typeof(Cache<string, int>.Tracker<Size>);
Console.WriteLine("types: " + entryA.Name + " " + (entryA == entryB) + " " + entryA.IsNested + " " + entryA.DeclaringType.Name + " args=" + entryA.GetGenericArguments().Length + "/" + tracker.GetGenericArguments().Length
    + " " + tracker.Name + " " + typeof(Cache<,>.Outcome).IsEnum + " " + entryA.IsValueType + " " + default(Cache<string, int>.Entry) + " " + new Cache<bool, bool>.Entry(true, false, 7));

var ids = string.Join(",", Enumerable.Range(0, 3).Select(_ => Registry.NextId("job")).Concat(new[] { Registry.NextId("task"), Registry.NextId("job") }));
Console.WriteLine("registry: " + ids + " " + Registry.Describe() + " " + Registry.Levels.Critical + "=" + (int)Registry.Levels.Critical + " " + (Registry.Levels.Low | Registry.Levels.High) + " " + Registry.Point.Origin.Shift(2, -1).Shift(1, 1));
Boot.Note("main ends");
foreach (string line in Boot.Lines) Console.WriteLine("boot: " + line);

public enum Size { Short, Long }

public static class Boot
{
    private static readonly List<string> notes = new List<string>();
    public static IReadOnlyList<string> Lines => notes;
    public static void Note(string text) => notes.Add(notes.Count + " " + text);
}

public static class Registry
{
    [Flags] public enum Levels { None = 0, Low = 1, High = 2, Critical = Low | High | 4 }
    public readonly struct Point
    {
        public static readonly Point Origin = new Point(0, 0);
        private readonly int x, y;
        private Point(int x, int y) { this.x = x; this.y = y; }
        public Point Shift(int dx, int dy) => new Point(x + dx, y + dy);
        public override string ToString() => "(" + x + "," + y + ")";
    }
    private static class Counters
    {
        public static readonly Dictionary<string, int> Next = new Dictionary<string, int>();
        static Counters() { Boot.Note("Registry.Counters static constructor"); }
    }
    private static readonly string prefix;
    static Registry() { prefix = "id"; Boot.Note("Registry static constructor"); }
    public static string NextId(string kind)
    {
        Counters.Next.TryGetValue(kind, out int last);
        Counters.Next[kind] = last + 1;
        return Format(kind, last + 1);
        static string Format(string kind, int number) => prefix + "-" + kind + number;
    }
    public static string Describe() => string.Join("+", Counters.Next.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + ":" + p.Value));
}

public sealed partial class Cache<TKey, TValue> : IEnumerable<Cache<TKey, TValue>.Entry> where TKey : IEquatable<TKey>
{
    public enum Outcome { Hit, Miss, Stored, Evicted }
    [Flags] public enum Flags { None = 0, Warm = 1, Full = 2, Trimmed = 4 }

    public readonly struct Entry
    {
        public Entry(TKey key, TValue value, int stamp) { Key = key; Value = value; Stamp = stamp; }
        public TKey Key { get; }
        public TValue Value { get; }
        public int Stamp { get; }
        public override string ToString() => Key + "=" + Value + "@" + Stamp;
    }

    private sealed class Node : IComparable<Node>
    {
        public TKey Key; public TValue Value; public int Stamp;
        public int CompareTo(Node other) => Stamp.CompareTo(other.Stamp);
        public Entry ToEntry() => new Entry(Key, Value, Stamp);
    }

    public sealed class Tracker<TTag>
    {
        private readonly Cache<TKey, TValue> owner;
        private readonly Func<TKey, TTag> tagOf;
        internal Tracker(Cache<TKey, TValue> owner, Func<TKey, TTag> tagOf) { this.owner = owner; this.tagOf = tagOf; }
        public int Count(TTag tag, Outcome outcome) => owner.journal.Count(j => j.Outcome == outcome && EqualityComparer<TTag>.Default.Equals(tagOf(j.Entry.Key), tag));
        public string Summary() => typeof(TTag).Name + "{" + string.Join(" ", owner.journal.GroupBy(j => tagOf(j.Entry.Key)).OrderBy(g => g.Key).Select(g => g.Key + "x" + g.Count())) + "}";
    }

    public static int Instances;
    private readonly Dictionary<TKey, Node> nodes = new Dictionary<TKey, Node>();
    private readonly List<(Outcome Outcome, Entry Entry)> journal = new List<(Outcome, Entry)>();
    private int capacity;

    static Cache() { Boot.Note("Cache<" + typeof(TKey).Name + "," + typeof(TValue).Name + "> static constructor"); }
    public Cache(int capacity) { Capacity = capacity; Instances++; }

    public partial int Capacity { get; set; }
    public partial TValue this[TKey key] { get; set; }
    public partial bool TryGet(TKey key, out TValue value);
    partial void OnEvicted(Entry entry);
    partial void OnAudit(int stamp);
    private partial int Tick();
}

public sealed partial class Cache<TKey, TValue> : IDisposable
{
    public static int DisposedCount;
    public int Clock { get; private set; }
    public int AuditCalls { get; private set; }
    public List<TKey> EvictedKeys { get; } = new List<TKey>();
    public IReadOnlyList<(Outcome Outcome, Entry Entry)> Journal => journal;
    public int Count => nodes.Count;
    public Flags State => (nodes.Count > 0 ? Flags.Warm : Flags.None) | (nodes.Count >= capacity ? Flags.Full : Flags.None) | (EvictedKeys.Count > 0 ? Flags.Trimmed : Flags.None);
    public string Stats => string.Join("/", Enum.GetValues<Outcome>().Select(o => journal.Count(j => j.Outcome == o)));

    public partial int Capacity
    {
        get => capacity;
        set
        {
            if (value < 1) throw new ArgumentOutOfRangeException(nameof(value));
            capacity = value;
            Trim();
        }
    }

    public partial TValue this[TKey key]
    {
        get => TryGet(key, out TValue value) ? value : throw new KeyNotFoundException();
        set
        {
            if (!nodes.TryGetValue(key, out Node node)) nodes[key] = node = new Node { Key = key };
            node.Value = value;
            node.Stamp = Tick();
            journal.Add((Outcome.Stored, node.ToEntry()));
            OnAudit(Tick());            // no implementing declaration: the call and its argument are removed
            Trim();
        }
    }

    public partial bool TryGet(TKey key, out TValue value)
    {
        bool found = nodes.TryGetValue(key, out Node node);
        value = found ? node.Value : default;
        if (found) node.Stamp = Tick();
        journal.Add((found ? Outcome.Hit : Outcome.Miss, found ? node.ToEntry() : new Entry(key, default, Clock)));
        return found;
    }

    private partial int Tick() => ++Clock;
    partial void OnEvicted(Entry entry) => EvictedKeys.Add(entry.Key);
    public Tracker<TTag> Track<TTag>(Func<TKey, TTag> tagOf) => new Tracker<TTag>(this, tagOf);
    public void Dispose() { nodes.Clear(); DisposedCount++; }
    public IEnumerator<Entry> GetEnumerator() => nodes.Values.OrderBy(n => n).Select(n => n.ToEntry()).GetEnumerator();
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    private void Trim()
    {
        while (nodes.Count > capacity)
        {
            Node oldest = nodes.Values.Min();
            nodes.Remove(oldest.Key);
            journal.Add((Outcome.Evicted, oldest.ToEntry()));
            OnEvicted(oldest.ToEntry());
        }
    }
}
