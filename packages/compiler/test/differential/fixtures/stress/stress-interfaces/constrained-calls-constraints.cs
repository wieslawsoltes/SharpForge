#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

public interface ICounter
{
    int Count { get; }
    void Increment();
}

public struct Tally : ICounter, IEquatable<Tally>, IDisposable
{
    public static int TypedEquals, ObjectEquals, Disposed;
    public int Count { get; private set; }
    public void Increment() => Count++;
    public void Dispose() { Count = -1; Disposed++; }
    public bool Equals(Tally other) { TypedEquals++; return Count == other.Count; }
    public override bool Equals(object? obj) { ObjectEquals++; return obj is Tally other && Count == other.Count; }
    public override int GetHashCode() => Count;
    public override string ToString() => "Tally(" + Count + ")";
}

public sealed class Gauge : ICounter, IComparable<Gauge>
{
    public Gauge() { }
    public Gauge(int count) { Count = count; }
    public int Count { get; private set; }
    public void Increment() => Count += 10;
    public int CompareTo(Gauge? other) => Count.CompareTo(other?.Count ?? int.MinValue);
    public override string ToString() => "Gauge(" + Count + ")";
}

public ref struct SlotCounter : ICounter
{
    private readonly Span<int> slot;
    public SlotCounter(Span<int> slot) { this.slot = slot; }
    public int Count => slot[0];
    public void Increment() => slot[0] += 100;
}

public struct Pair { public short Left; public short Right; }
public enum Access { None = 0, Read = 1, Write = 2, Admin = 4 }
public delegate int Reducer<T>(T value) where T : allows ref struct;

public sealed class Holder
{
    public readonly Tally Frozen;
    public Tally Live;
    public Tally Property { get; set; }
    public Holder(Tally seed) { Frozen = seed; Live = seed; Property = seed; }
}

public abstract class Lookup
{
    public abstract T? Find<T>(string key, T? fallback);
    public abstract T? Find<T>(string key, T? fallback) where T : struct;
}

public sealed class Settings : Lookup
{
    private readonly Dictionary<string, object> values = new() { ["port"] = 8080, ["host"] = "localhost", ["ratio"] = 0.5, ["mode"] = Access.Write };
    public override T? Find<T>(string key, T? fallback) where T : default => values.TryGetValue(key, out var value) && value is T typed ? typed : fallback;
    public override T? Find<T>(string key, T? fallback) where T : struct => values.TryGetValue(key, out var value) && value is T typed ? typed : fallback;
}

public static class Ops
{
    public static int BumpRef<T>(ref T counter, int times) where T : ICounter, allows ref struct
    {
        for (int i = 0; i < times; i++) counter.Increment();
        return counter.Count;
    }
    public static int BumpValue<T>(T counter, int times) where T : ICounter
    {
        for (int i = 0; i < times; i++) counter.Increment();
        return counter.Count;
    }
    public static int BumpBoxed(ICounter counter, int times)
    {
        for (int i = 0; i < times; i++) counter.Increment();
        return counter.Count;
    }
    public static int Peek(in Tally tally) { tally.Increment(); return tally.Count; }
    public static T Fresh<T>(int times) where T : struct, ICounter { T counter = default; BumpRef(ref counter, times); return counter; }
    public static T Largest<T>(params T[] items) where T : class, IComparable<T>, new()
    {
        T best = new T();
        foreach (T item in items) if (item.CompareTo(best) > 0) best = item;
        return best;
    }
    public static bool Same<T>(T left, T right) where T : IEquatable<T> => left.Equals(right);
    public static int ByteSum<T>(ReadOnlySpan<T> values) where T : unmanaged
    {
        int sum = 0;
        foreach (byte b in MemoryMarshal.AsBytes(values)) sum += b;
        return sum;
    }
    public static string Layout<T>() where T : unmanaged => typeof(T).Name + "=" + Unsafe.SizeOf<T>();
    public static SortedDictionary<TKey, int> Histogram<TKey>(IEnumerable<TKey> keys) where TKey : notnull
    {
        var counts = new SortedDictionary<TKey, int>();
        foreach (TKey key in keys) counts[key] = counts.TryGetValue(key, out int seen) ? seen + 1 : 1;
        return counts;
    }
    public static int Fold<T>(T source, Reducer<T> reduce) where T : allows ref struct => reduce(source);
    public static int Transfer<TFrom, TTo>(IEnumerable<TFrom> from, ICollection<TTo> to) where TFrom : TTo
    {
        foreach (TFrom item in from) to.Add(item);
        return to.Count;
    }
    public static TEnum Union<TEnum>(params string[] names) where TEnum : struct, Enum =>
        (TEnum)Enum.ToObject(typeof(TEnum), names.Select(n => Convert.ToInt32(Enum.Parse<TEnum>(n, ignoreCase: true))).Aggregate(0, (a, b) => a | b));
    public static TDelegate Twice<TDelegate>(TDelegate handler) where TDelegate : Delegate => (TDelegate)Delegate.Combine(handler, handler);
}

public static class Program
{
    public static void Main()
    {
        Tally tally = default;
        Console.WriteLine("ref=" + Ops.BumpRef(ref tally, 3) + " after=" + tally.Count + " value=" + Ops.BumpValue(tally, 2) + " after=" + tally.Count + " boxed=" + Ops.BumpBoxed(tally, 2) + " after=" + tally.Count
            + " in=" + Ops.Peek(in tally) + " after=" + tally.Count);
        ICounter box = tally;
        box.Increment();
        int viaInterfaceGeneric = Ops.BumpRef(ref box, 1), viaValueGeneric = Ops.BumpValue(box, 1);
        Console.WriteLine("box: " + viaInterfaceGeneric + " " + viaValueGeneric + " " + box.Count + " " + Ops.BumpBoxed(box, 1) + " unboxed copy=" + ((Tally)box).Count + " original=" + tally.Count + " " + box + " " + ReferenceEquals(box, box));

        var array = new Tally[3];
        var list = new List<Tally> { default, default };
        array[0].Increment();
        Ops.BumpRef(ref array[1], 4);
        foreach (var item in array) item.Increment();
        list[0].Increment();
        var copy = list[1]; copy.Increment(); list[1] = copy;
        ref Tally alias = ref array[2];
        alias.Increment(); alias.Increment();
        Console.WriteLine("array: " + string.Join(",", array.Select(t => t.Count)) + " list: " + string.Join(",", list.Select(t => t.Count)) + " span: " + BumpSpan(array) + " -> " + string.Join(",", array));

        var holder = new Holder(tally);
        holder.Frozen.Increment();
        holder.Live.Increment();
        holder.Property.Increment();
        Console.WriteLine("holder: frozen=" + holder.Frozen.Count + " live=" + holder.Live.Count + " property=" + holder.Property.Count + " fresh=" + Ops.Fresh<Tally>(7) + " " + Ops.BumpValue(Ops.Fresh<Tally>(1), 1));
        using (Tally scoped = tally) { Console.WriteLine("using: inside=" + scoped.Count + " disposedBefore=" + Tally.Disposed); }
        Console.WriteLine("using: disposedAfter=" + Tally.Disposed + " original=" + tally.Count);

        var gauge = new Gauge(5);
        Gauge sameGauge = gauge;
        Console.WriteLine("class: ref=" + Ops.BumpRef(ref gauge, 1) + " value=" + Ops.BumpValue(gauge, 1) + " boxed=" + Ops.BumpBoxed(gauge, 1) + " after=" + sameGauge.Count
            + " largest=" + Ops.Largest(new Gauge(3), gauge, new Gauge(20)) + " " + Ops.Largest<Gauge>() + " " + Ops.Largest(new Gauge(-5)));

        Span<int> slots = stackalloc int[] { 1, 2, 3 };
        var slotCounter = new SlotCounter(slots.Slice(1));
        Console.WriteLine("ref struct: " + Ops.BumpRef(ref slotCounter, 2) + " slots=" + slots[0] + "," + slots[1] + "," + slots[2] + " fold=" + Ops.Fold(slots, s => { int sum = 0; foreach (int v in s) sum += v; return sum; })
            + " " + Ops.Fold<ReadOnlySpan<char>>("hello world", s => s.IndexOf('w')) + " " + Ops.Fold(new[] { 4, 5 }, a => a.Length) + " " + Ops.Fold(21, v => v * 2));

        Tally.TypedEquals = Tally.ObjectEquals = 0;
        bool typed = Ops.Same(tally, tally), viaObject = tally.Equals((object)tally), viaComparer = EqualityComparer<Tally>.Default.Equals(tally, default), viaStatic = Equals(tally, tally);
        Console.WriteLine("equals: " + typed + " " + viaObject + " " + viaComparer + " " + viaStatic + " typedCalls=" + Tally.TypedEquals + " objectCalls=" + Tally.ObjectEquals + " " + Ops.Same("a", "a") + " " + Ops.Same(1.5, 1.50) + " " + new Pair().Equals(new Pair()));

        Console.WriteLine("unmanaged: " + Ops.ByteSum<int>(new[] { 1, 256, 65536, -1 }) + " " + Ops.ByteSum<Pair>(new[] { new Pair { Left = 1, Right = -1 } }) + " " + Ops.ByteSum<double>(new[] { 1.0 }) + " " + Ops.ByteSum<char>("AB")
            + " " + Ops.ByteSum<Access>(new[] { Access.Admin, Access.Write }) + " | " + Ops.Layout<byte>() + " " + Ops.Layout<char>() + " " + Ops.Layout<Pair>() + " " + Ops.Layout<long>() + " " + Ops.Layout<decimal>() + " " + Ops.Layout<Access>() + " " + Ops.Layout<(byte, long)>());
        Console.WriteLine("notnull: " + string.Join(" ", Ops.Histogram("mississippi").Select(p => p.Key + "=" + p.Value)) + " | " + string.Join(" ", Ops.Histogram(new[] { 3, 1, 3, 3, 2, 1 }).Select(p => p.Key + "x" + p.Value))
            + " | " + string.Join(" ", Ops.Histogram(new[] { Access.Read, Access.Admin, Access.Read }).Select(p => p.Key + ":" + p.Value)));

        var counters = new List<ICounter>();
        var objects = new List<object?>();
        int afterGauges = Ops.Transfer(new[] { new Gauge(1), new Gauge(2) }, counters), afterTallies = Ops.Transfer(new[] { tally, Ops.Fresh<Tally>(9) }, counters);
        foreach (ICounter counter in counters) counter.Increment();
        Console.WriteLine("T : U -> " + afterGauges + "," + afterTallies + " " + string.Join(" ", counters) + " objects=" + Ops.Transfer(new[] { "a", "b" }, objects) + "," + Ops.Transfer<ICounter, object?>(counters, objects) + "," + Ops.Transfer(new int?[] { 1, null }, objects)
            + " nulls=" + objects.Count(o => o is null) + " original=" + tally.Count);

        Func<int, int> square = x => x * x;
        int calls = 0;
        Action count = () => calls++;
        Ops.Twice(Ops.Twice(count))();
        Console.WriteLine("enum/delegate: " + Ops.Union<Access>("read", "ADMIN") + " " + Ops.Union<Access>() + " " + (int)Ops.Union<DayOfWeek>("Monday", "Friday") + " " + Ops.Twice(square)(7) + " " + Ops.Twice(square).GetInvocationList().Length + " calls=" + calls);

        Lookup settings = new Settings();
        int port = settings.Find<int>("port", 80), missingPort = settings.Find<int>("nope", 80);
        int? maybe = settings.Find<int>("nope", null), wrongType = settings.Find<int>("host", null), present = settings.Find<int>("port", null);
        string? host = settings.Find<string>("host", null), missingHost = settings.Find<string>("nope", null);
        Console.WriteLine("default constraint: " + port + " " + missingPort + " " + (maybe?.ToString() ?? "null") + " " + (wrongType.HasValue ? "set" : "unset") + " " + present + " " + host + " " + (missingHost ?? "<none>")
            + " " + (int)(settings.Find("ratio", 1.0) * 4) + " " + settings.Find<Access>("mode", null) + " " + settings.Find("mode", Access.None) + " " + (settings.Find<object>("port", null) is int) + " " + settings.Find("host", "fallback")!.Length);
    }

    private static int BumpSpan(Span<Tally> span)
    {
        foreach (ref Tally item in span) item.Increment();
        return span.Length;
    }
}
