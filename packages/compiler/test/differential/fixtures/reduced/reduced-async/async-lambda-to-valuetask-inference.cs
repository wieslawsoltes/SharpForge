using System;
using System.Collections.Generic;
using System.Threading.Tasks;

// Reduced from stress-tasks/async-streams-staged-import: the result type of an async lambda is inferred through a
// delegate that returns `ValueTask<TOut>` as it is through one that returns `Task<TOut>`.
public static class AsyncSeq
{
    public static async IAsyncEnumerable<TOut> Select<T, TOut>(this IAsyncEnumerable<T> source, Func<T, ValueTask<TOut>> selector)
    {
        await foreach (T item in source) yield return await selector(item);
    }

    public static async Task<TOut> Once<T, TOut>(T value, Func<T, ValueTask<TOut>> selector) => await selector(value);

    public static async Task<TOut> Twice<T, TOut>(T value, Func<T, Task<TOut>> selector) => await selector(await selector(value) is T again ? again : value);

    public static async IAsyncEnumerable<int> Range(int count)
    {
        for (int i = 1; i <= count; i++)
        {
            await Task.Yield();
            yield return i;
        }
    }
}

public static class Program
{
    public static async Task Main()
    {
        var texts = new List<string>();
        await foreach (string text in AsyncSeq.Range(3).Select(async n => { await Task.Yield(); return "n" + n * n; })) texts.Add(text);
        Console.WriteLine(string.Join(",", texts));
        Console.WriteLine(await AsyncSeq.Once(20, async n => { await Task.Yield(); return n / 8.0; }));
        Console.WriteLine(await AsyncSeq.Once("ab", text => new ValueTask<int>(text.Length)));
        Console.WriteLine(await AsyncSeq.Twice(3, async n => { await Task.Yield(); return n * 2; }));
    }
}
