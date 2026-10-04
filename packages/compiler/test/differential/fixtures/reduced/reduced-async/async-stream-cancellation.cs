using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

public static class Program
{
    static async IAsyncEnumerable<int> CountAsync(int count, [EnumeratorCancellation] CancellationToken token = default)
    {
        for (int i = 0; i < count; i++)
        {
            await Task.Yield();
            token.ThrowIfCancellationRequested();
            yield return i;
        }
    }

    static async Task<string> ReadAsync(IAsyncEnumerable<int> source, CancellationTokenSource cancelAfterThree, CancellationToken token)
    {
        int seen = 0;
        try
        {
            await foreach (int value in source.WithCancellation(token).ConfigureAwait(false))
            {
                if (++seen == 3) cancelAfterThree?.Cancel();
            }
            return "completed " + seen;
        }
        catch (OperationCanceledException)
        {
            return "cancelled after " + seen;
        }
    }

    public static async Task Main()
    {
        using var first = new CancellationTokenSource();
        Console.WriteLine(await ReadAsync(CountAsync(10), first, first.Token));
        using var second = new CancellationTokenSource();
        Console.WriteLine(await ReadAsync(CountAsync(10, second.Token), second, default));
        using var third = new CancellationTokenSource();
        using var other = new CancellationTokenSource();
        Console.WriteLine(await ReadAsync(CountAsync(10, other.Token), third, third.Token));
        using var fourth = new CancellationTokenSource();
        Console.WriteLine(await ReadAsync(CountAsync(10, fourth.Token), fourth, new CancellationTokenSource().Token));
        Console.WriteLine(await ReadAsync(CountAsync(5), null, default));
        var list = new List<int>();
        await foreach (int value in CountAsync(3).ConfigureAwait(false)) list.Add(value);
        var enumerator = CountAsync(2).GetAsyncEnumerator(new CancellationToken(true));
        try { await enumerator.MoveNextAsync(); }
        catch (OperationCanceledException) { list.Add(-1); }
        finally { await enumerator.DisposeAsync(); }
        Console.WriteLine(string.Join(",", list));
    }
}
