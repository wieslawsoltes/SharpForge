using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

public sealed class Sensor : IAsyncDisposable
{
    private readonly List<string> log;
    private readonly string name;
    public Sensor(string name, List<string> log) { this.name = name; this.log = log; log.Add(name + " open"); }

    public async IAsyncEnumerable<double> ReadAsync(int count, [EnumeratorCancellation] CancellationToken token = default)
    {
        try
        {
            for (int i = 0; i < count; i++)
            {
                await Task.Yield();
                token.ThrowIfCancellationRequested();
                yield return 20 + i * 0.5;
            }
        }
        finally
        {
            log.Add(name + " stream ended");
        }
    }

    public async ValueTask DisposeAsync()
    {
        await Task.Delay(1);
        log.Add(name + " closed");
    }
}

public static class AsyncSequence
{
    public static async IAsyncEnumerable<int> Range(int start, int count)
    {
        for (int i = 0; i < count; i++)
        {
            if (i % 2 == 0) await Task.Yield();
            yield return start + i;
        }
    }

    public static async IAsyncEnumerable<TResult> Select<T, TResult>(this IAsyncEnumerable<T> source, Func<T, TResult> map)
    {
        await foreach (var item in source) yield return map(item);
    }

    public static async IAsyncEnumerable<T> Where<T>(this IAsyncEnumerable<T> source, Func<T, ValueTask<bool>> predicate)
    {
        await foreach (var item in source)
            if (await predicate(item)) yield return item;
    }

    public static async IAsyncEnumerable<T> Take<T>(this IAsyncEnumerable<T> source, int count)
    {
        if (count <= 0) yield break;
        await foreach (var item in source)
        {
            yield return item;
            if (--count == 0) yield break;
        }
    }

    public static async IAsyncEnumerable<IReadOnlyList<T>> Window<T>(this IAsyncEnumerable<T> source, int size)
    {
        var window = new Queue<T>();
        await foreach (var item in source)
        {
            window.Enqueue(item);
            if (window.Count > size) window.Dequeue();
            if (window.Count == size) yield return window.ToArray();
        }
    }

    public static async Task<List<T>> ToListAsync<T>(this IAsyncEnumerable<T> source, CancellationToken token = default)
    {
        var list = new List<T>();
        await foreach (var item in source.WithCancellation(token).ConfigureAwait(false)) list.Add(item);
        return list;
    }

    public static async ValueTask<TAccumulate> AggregateAsync<T, TAccumulate>(this IAsyncEnumerable<T> source, TAccumulate seed, Func<TAccumulate, T, TAccumulate> fold)
    {
        await foreach (var item in source) seed = fold(seed, item);
        return seed;
    }

    public static async IAsyncEnumerable<(T1, T2)> Zip<T1, T2>(this IAsyncEnumerable<T1> first, IAsyncEnumerable<T2> second)
    {
        await using var left = first.GetAsyncEnumerator();
        await using var right = second.GetAsyncEnumerator();
        while (await left.MoveNextAsync() && await right.MoveNextAsync()) yield return (left.Current, right.Current);
    }

    public static async IAsyncEnumerable<int> Failing(int good)
    {
        for (int i = 0; i < good; i++) { await Task.Yield(); yield return i; }
        throw new InvalidOperationException("stream broke after " + good);
    }
}

public static class Program
{
    public static async Task Main()
    {
        var log = new List<string>();
        Console.WriteLine(string.Join(",", await AsyncSequence.Range(1, 6).ToListAsync()) + " " + await AsyncSequence.Range(1, 10).AggregateAsync(0, (sum, n) => sum + n));
        var evens = AsyncSequence.Range(0, 100).Where(async n => { await Task.Yield(); return n % 2 == 0; }).Select(n => n * n).Take(5);
        Console.WriteLine(string.Join(",", await evens.ToListAsync()) + " " + (await AsyncSequence.Range(0, 5).Take(0).ToListAsync()).Count);
        await foreach (var window in AsyncSequence.Range(1, 5).Window(3)) Console.Write("[" + string.Join("", window) + "]");
        Console.WriteLine();
        await foreach (var (number, word) in AsyncSequence.Range(1, 10).Zip(AsyncSequence.Range(0, 3).Select(i => new[] { "a", "b", "c" }[i]))) Console.Write(number + word + " ");
        Console.WriteLine();

        await using (var sensor = new Sensor("s1", log))
        {
            double total = 0;
            int readings = 0;
            await foreach (double value in sensor.ReadAsync(10))
            {
                total += value;
                if (++readings == 4) break;
            }
            log.Add("average " + total / readings);
        }
        Console.WriteLine(string.Join(" | ", log));
        log.Clear();

        using var source = new CancellationTokenSource();
        await using var second = new Sensor("s2", log);
        try
        {
            int seen = 0;
            await foreach (double value in second.ReadAsync(100).WithCancellation(source.Token))
            {
                if (++seen == 3) source.Cancel();
            }
        }
        catch (OperationCanceledException) { log.Add("cancelled"); }
        try
        {
            await foreach (int value in AsyncSequence.Failing(2)) log.Add("got " + value);
        }
        catch (InvalidOperationException e) { log.Add(e.Message); }
        finally { log.Add("finally"); }
        Console.WriteLine(string.Join(" | ", log));

        var enumerator = AsyncSequence.Range(10, 3).GetAsyncEnumerator();
        var manual = new List<int>();
        try { while (await enumerator.MoveNextAsync()) manual.Add(enumerator.Current); }
        finally { await enumerator.DisposeAsync(); }
        IAsyncEnumerable<int> empty = AsyncSequence.Range(0, 0);
        Console.WriteLine(string.Join("", manual) + " " + await empty.AggregateAsync("none", (text, n) => text + n) + " " + await AsyncSequence.Range(1, 4).Select(n => n.ToString()).AggregateAsync("", string.Concat));
    }
}
