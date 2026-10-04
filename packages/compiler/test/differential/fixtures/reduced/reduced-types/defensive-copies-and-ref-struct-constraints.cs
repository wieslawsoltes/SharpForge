#nullable enable
using System;
using System.Collections.Generic;

// Reduced from stress-interfaces/constrained-calls-constraints: a mutating member called on a struct in a read-only
// variable (`in` parameter, readonly field, `ref readonly` local) acts on a copy - but not on a `using` or `foreach` variable; `allows ref struct` is written to
// the type parameter; and overrides that differ only in `where T : struct` / `where T : default` match their bases.
public interface ICounter
{
    int Count { get; }
    void Increment();
}

public struct Tally : ICounter
{
    public int Count { get; private set; }
    public void Increment() => Count++;
    public readonly int Peek() => Count;
}

public struct Meter : IDisposable
{
    public int Uses;
    public void Use() => Uses++;
    public void Dispose() { }
}

public ref struct SlotCounter : ICounter
{
    private readonly Span<int> slot;
    public SlotCounter(Span<int> slot) { this.slot = slot; }
    public int Count => slot[0];
    public void Increment() => slot[0]++;
}

public abstract class Lookup
{
    public abstract T? Find<T>(string key, T? fallback);
    public abstract T? Find<T>(string key, T? fallback) where T : struct;
}

public sealed class Settings : Lookup
{
    private readonly Dictionary<string, object> values = new() { ["size"] = 4, ["name"] = "main" };
    public override T? Find<T>(string key, T? fallback) where T : default => values.TryGetValue(key, out var value) && value is T typed ? typed : fallback;
    public override T? Find<T>(string key, T? fallback) where T : struct => values.TryGetValue(key, out var value) && value is T typed ? typed : fallback;
}

public sealed class Holder
{
    private readonly Tally fixedTally;
    private Tally free;
    public Holder() { fixedTally.Increment(); }
    public string Bump()
    {
        fixedTally.Increment();
        free.Increment();
        return fixedTally.Count + "/" + free.Count + "/" + fixedTally.Peek();
    }
}

public static class Program
{
    private static int BumpRef<T>(ref T counter, int times) where T : ICounter, allows ref struct
    {
        for (int i = 0; i < times; i++) counter.Increment();
        return counter.Count;
    }

    private static int Peek(in Tally tally)
    {
        tally.Increment();
        return tally.Count;
    }

    public static void Main()
    {
        var tally = new Tally();
        Console.WriteLine(BumpRef(ref tally, 3) + " " + Peek(in tally) + " " + tally.Count);
        ref readonly Tally view = ref tally;
        view.Increment();
        Console.WriteLine(view.Count + " " + tally.Count + " " + new Holder().Bump());
        Span<int> cell = stackalloc int[1];
        var slot = new SlotCounter(cell);
        Console.WriteLine(BumpRef(ref slot, 4) + " " + cell[0]);
        // A `using` or `foreach` variable cannot be assigned, but members act on the variable itself.
        using (var meter = new Meter())
        {
            meter.Use();
            meter.Use();
            foreach (var item in new[] { new Tally() })
            {
                item.Increment();
                Console.WriteLine(meter.Uses + " " + item.Count);
            }
        }
        Lookup settings = new Settings();
        Console.WriteLine(settings.Find<string>("name", "none") + " " + settings.Find<int>("size", null) + " " + (settings.Find<int>("missing", null) ?? -1));
    }
}
