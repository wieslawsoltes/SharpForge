using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

public readonly record struct Row(int Line, string Sku, int Quantity, decimal Price);

public sealed class ImportStats
{
    public int Read, Blank, Malformed, Rejected, Loaded;
    public override string ToString() => $"read={Read} blank={Blank} malformed={Malformed} rejected={Rejected} loaded={Loaded}";
}

public static class AsyncSeq
{
    public static async IAsyncEnumerable<T> Where<T>(this IAsyncEnumerable<T> source, Func<T, bool> predicate)
    {
        await foreach (T item in source) if (predicate(item)) yield return item;
    }

    public static async IAsyncEnumerable<TOut> Select<T, TOut>(this IAsyncEnumerable<T> source, Func<T, ValueTask<TOut>> selector)
    {
        await foreach (T item in source) yield return await selector(item);
    }

    public static async IAsyncEnumerable<T> Take<T>(this IAsyncEnumerable<T> source, int count)
    {
        if (count <= 0) yield break;
        await foreach (T item in source)
        {
            yield return item;
            if (--count == 0) yield break;
        }
    }

    public static async IAsyncEnumerable<List<T>> Batch<T>(this IAsyncEnumerable<T> source, int size)
    {
        var batch = new List<T>(size);
        await foreach (T item in source)
        {
            batch.Add(item);
            if (batch.Count < size) continue;
            yield return batch;
            batch = new List<T>(size);
        }
        if (batch.Count > 0) yield return batch;
    }

    public static async IAsyncEnumerable<T> Interleave<T>(this IAsyncEnumerable<T> first, IAsyncEnumerable<T> second)
    {
        await using IAsyncEnumerator<T> a = first.GetAsyncEnumerator();
        await using IAsyncEnumerator<T> b = second.GetAsyncEnumerator();
        bool moreA = true, moreB = true;
        while (moreA | moreB)
        {
            if (moreA && (moreA = await a.MoveNextAsync())) yield return a.Current;
            if (moreB && (moreB = await b.MoveNextAsync())) yield return b.Current;
        }
    }

    public static async Task<List<T>> ToListAsync<T>(this IAsyncEnumerable<T> source)
    {
        var list = new List<T>();
        await foreach (T item in source.ConfigureAwait(false)) list.Add(item);
        return list;
    }
}

public static class Program
{
    private static readonly List<string> log = new List<string>();
    private static string Drain() { string text = string.Join(" ", log); log.Clear(); return text; }

    private static async IAsyncEnumerable<string> ReadLinesAsync(string name, string[] lines, [EnumeratorCancellation] CancellationToken token = default)
    {
        log.Add("open:" + name);
        try
        {
            foreach (string line in lines)
            {
                token.ThrowIfCancellationRequested();
                await Task.Yield();
                yield return line ?? throw new InvalidOperationException("corrupt block in " + name);
            }
            log.Add("eof:" + name);
        }
        finally { log.Add("close:" + name); }
    }

    private static async IAsyncEnumerable<Row> ParseAsync(IAsyncEnumerable<string> lines, ImportStats stats)
    {
        int number = 0;
        await foreach (string line in lines)
        {
            number++;
            if (number == 1) continue;
            stats.Read++;
            if (string.IsNullOrWhiteSpace(line)) { stats.Blank++; continue; }
            Row row;
            try
            {
                string[] cells = line.Split(';');
                row = new Row(number, cells[0].Trim(), int.Parse(cells[1], CultureInfo.InvariantCulture), decimal.Parse(cells[2], CultureInfo.InvariantCulture));
            }
            catch (Exception e) when (e is FormatException or IndexOutOfRangeException) { stats.Malformed++; continue; }
            yield return row;
        }
    }

    private static async IAsyncEnumerable<int> CountAsync(int from, int count)
    {
        for (int i = 0; i < count; i++) { await Task.Yield(); yield return from + i; }
    }

    public static async Task Main()
    {
        string[] feed = { "sku;qty;price", "bolt;40;0.25", "", "gear;two;12.5", "gear;2;12.5", "belt;0;7", "cog", "belt;3;7.00", " nut ;100;0.05", "bolt;10;0.25" };
        var stats = new ImportStats();
        var stock = new SortedDictionary<string, (int Quantity, decimal Value)>(StringComparer.Ordinal);

        IAsyncEnumerable<List<Row>> stages = ParseAsync(ReadLinesAsync("feed", feed), stats)
            .Where(row => { if (row.Quantity > 0) return true; stats.Rejected++; return false; })
            .Select(async row => { await Task.Yield(); return row with { Price = row.Price * row.Quantity }; })
            .Batch(2);
        Console.WriteLine("pipeline built, nothing read yet: [" + Drain() + "] " + stats);

        await foreach (List<Row> batch in stages)
        {
            foreach (Row row in batch)
            {
                stock.TryGetValue(row.Sku, out var current);
                stock[row.Sku] = (current.Quantity + row.Quantity, current.Value + row.Price);
                stats.Loaded++;
            }
            Console.WriteLine("batch of " + batch.Count + ": " + string.Join(", ", batch.ConvertAll(r => r.Line + ":" + r.Sku)));
        }
        Console.WriteLine(stats + " [" + Drain() + "]");
        foreach (var (sku, (quantity, value)) in stock) Console.WriteLine("  " + sku.PadRight(5) + quantity.ToString().PadLeft(4) + " " + value.ToString("0.00", CultureInfo.InvariantCulture));

        List<string> firstTwo = await ReadLinesAsync("peek", feed).Take(2).ToListAsync();
        Console.WriteLine("take 2 -> " + string.Join("|", firstTwo) + " [" + Drain() + "]");
        List<string> none = await ReadLinesAsync("skip", feed).Take(0).ToListAsync();
        Console.WriteLine("take 0 -> " + none.Count + " [" + Drain() + "]");

        using (var cts = new CancellationTokenSource())
        {
            var seen = new List<string>();
            try
            {
                await foreach (string line in ReadLinesAsync("cancel", feed).WithCancellation(cts.Token))
                {
                    seen.Add(line.Length.ToString());
                    if (seen.Count == 3) cts.Cancel();
                }
            }
            catch (OperationCanceledException e) { log.Add("cancelled(token=" + (e.CancellationToken == cts.Token) + ")"); }
            Console.WriteLine("lengths " + string.Join(",", seen) + " [" + Drain() + "]");
        }

        try { await foreach (string line in ReadLinesAsync("corrupt", new[] { "a", "b", null, "d" })) log.Add("line:" + line); }
        catch (InvalidOperationException e) { log.Add("failed:" + e.Message); }
        Console.WriteLine(Drain());

        IAsyncEnumerator<string> manual = ReadLinesAsync("manual", feed).GetAsyncEnumerator();
        log.Add("created");
        bool moved = await manual.MoveNextAsync();
        log.Add(moved + ":" + manual.Current);
        await manual.DisposeAsync();
        IAsyncEnumerator<string> unused = ReadLinesAsync("unused", feed).GetAsyncEnumerator();
        await unused.DisposeAsync();
        Console.WriteLine(Drain() + " after dispose MoveNext=" + await manual.MoveNextAsync());

        List<int> mixed = await CountAsync(1, 5).Interleave(CountAsync(100, 2)).Where(n => n != 3).ToListAsync();
        Console.WriteLine("interleave " + string.Join(",", mixed));
        int total = 0, batches = 0;
        await foreach (List<int> chunk in CountAsync(1, 10).Select(n => new ValueTask<int>(n * n)).Batch(4))
        {
            batches++;
            foreach (int square in chunk) total += square;
        }
        Console.WriteLine("squares total=" + total + " batches=" + batches);
    }
}
