using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

public interface IStage<TIn, TOut>
{
    Task<TOut> RunAsync(TIn input, CancellationToken token);
}

public sealed class DelegateStage<TIn, TOut> : IStage<TIn, TOut>
{
    private readonly Func<TIn, CancellationToken, Task<TOut>> run;
    public DelegateStage(Func<TIn, CancellationToken, Task<TOut>> run) { this.run = run; }
    public Task<TOut> RunAsync(TIn input, CancellationToken token) => run(input, token);
}

public static class Stage
{
    public static IStage<TIn, TOut> Create<TIn, TOut>(Func<TIn, TOut> map) => new DelegateStage<TIn, TOut>(async (input, token) =>
    {
        await Task.Yield();
        token.ThrowIfCancellationRequested();
        return map(input);
    });

    public static IStage<TIn, TOut> Then<TIn, TMiddle, TOut>(this IStage<TIn, TMiddle> first, IStage<TMiddle, TOut> second)
        => new DelegateStage<TIn, TOut>(async (input, token) => await second.RunAsync(await first.RunAsync(input, token), token));

    public static IStage<TIn, TOut> Retry<TIn, TOut>(this IStage<TIn, TOut> stage, int attempts, List<string> log)
        => new DelegateStage<TIn, TOut>(async (input, token) =>
        {
            for (int attempt = 1; ; attempt++)
            {
                try { return await stage.RunAsync(input, token); }
                catch (InvalidOperationException e) when (attempt < attempts)
                {
                    log.Add($"retry {attempt}: {e.Message}");
                    await Task.Delay(1, token);
                }
            }
        });
}

public sealed class Cache<TKey, TValue>
{
    private readonly Dictionary<TKey, Task<TValue>> tasks = new Dictionary<TKey, Task<TValue>>();
    private readonly Func<TKey, Task<TValue>> load;
    public int Loads { get; private set; }
    public Cache(Func<TKey, Task<TValue>> load) { this.load = load; }

    public ValueTask<TValue> GetAsync(TKey key)
    {
        if (tasks.TryGetValue(key, out var task) && task.IsCompletedSuccessfully) return new ValueTask<TValue>(task.Result);
        return new ValueTask<TValue>(LoadAsync(key));
    }

    private async Task<TValue> LoadAsync(TKey key)
    {
        if (!tasks.TryGetValue(key, out var task))
        {
            Loads++;
            tasks[key] = task = load(key);
        }
        return await task;
    }
}

public static class Program
{
    private static int flaky;

    private static async Task<int> SlowSquareAsync(int value, int delay)
    {
        await Task.Delay(delay);
        return value * value;
    }

    private static async Task<string> DescribeAsync(Task<int> source)
    {
        try
        {
            int value = await source;
            return "value " + value;
        }
        catch (OperationCanceledException) { return "cancelled"; }
        catch (Exception e) { return "failed " + e.GetType().Name; }
    }

    private static async ValueTask<int> SumAsync(IEnumerable<Task<int>> tasks)
    {
        int total = 0;
        foreach (var task in tasks) total += await task;
        return total;
    }

    public static async Task Main()
    {
        var log = new List<string>();
        var parse = Stage.Create<string, int>(int.Parse);
        var doubled = Stage.Create<int, int>(x => x * 2);
        var unreliable = new DelegateStage<int, int>(async (x, token) =>
        {
            await Task.Yield();
            if (++flaky % 3 != 0) throw new InvalidOperationException("flaky " + flaky);
            return x + 1;
        });
        var format = Stage.Create<int, string>(x => $"<{x:D4}>");
        var pipeline = parse.Then(doubled).Then(unreliable.Retry(3, log)).Then(format);
        Console.WriteLine(await pipeline.RunAsync("21", CancellationToken.None) + " " + await pipeline.RunAsync("100", default) + " | " + string.Join("; ", log));
        try { await pipeline.RunAsync("abc", default); }
        catch (FormatException) { Console.WriteLine("format error surfaced"); }
        try { await parse.Then(unreliable.Retry(2, log)).RunAsync("1", default); }
        catch (InvalidOperationException e) { Console.WriteLine("gave up: " + e.Message + ", log " + log.Count); }
        using (var cancelled = new CancellationTokenSource())
        {
            cancelled.Cancel();
            try { await pipeline.RunAsync("5", cancelled.Token); }
            catch (OperationCanceledException) { Console.WriteLine("cancelled " + cancelled.IsCancellationRequested); }
        }

        var squares = await Task.WhenAll(Enumerable.Range(1, 5).Select(n => SlowSquareAsync(n, (6 - n) * 3)));
        var first = await Task.WhenAny(SlowSquareAsync(7, 200), SlowSquareAsync(3, 1));
        Console.WriteLine(string.Join(",", squares) + " " + await first + " " + await SumAsync(new[] { Task.FromResult(1), SlowSquareAsync(4, 2), Task.Run(() => 25) }));

        var cache = new Cache<string, int>(async key => { await Task.Delay(2); return key.Length; });
        var lengths = new List<int>();
        foreach (var key in new[] { "alpha", "be", "alpha", "be", "gamma!" }) lengths.Add(await cache.GetAsync(key));
        ValueTask<int> hot = cache.GetAsync("alpha");
        Console.WriteLine(string.Join("", lengths) + " loads=" + cache.Loads + " " + hot.IsCompletedSuccessfully + " " + hot.Result);

        var completion = new TaskCompletionSource<int>();
        var waiting = DescribeAsync(completion.Task);
        Console.WriteLine(waiting.IsCompleted);
        completion.SetResult(99);
        var failed = new TaskCompletionSource<int>();
        failed.SetException(new TimeoutException());
        var stopped = new TaskCompletionSource<int>();
        stopped.SetCanceled();
        Console.WriteLine(await waiting + ", " + await DescribeAsync(failed.Task) + ", " + await DescribeAsync(stopped.Task) + ", " + await DescribeAsync(Task.FromException<int>(new ArgumentException())) + ", " + completion.TrySetResult(1));

        Func<int, Task<int>> recursive = null;
        recursive = async n => n <= 1 ? 1 : n * await recursive(n - 1);
        Task<int>[] started = { recursive(5), recursive(6) };
        await Task.WhenAll(started);
        var continued = await started[0].ContinueWith(t => t.Result + 1);
        Console.WriteLine(started[0].Result + " " + started[1].Result + " " + continued + " " + started.All(t => t.Status == TaskStatus.RanToCompletion) + " " + Task.CompletedTask.IsCompleted + " " + (await Task.FromResult("x")).Length);
    }
}
