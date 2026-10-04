using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

public sealed class AsyncQueue<T>
{
    private readonly Queue<T> items = new Queue<T>();
    private readonly Queue<TaskCompletionSource<T>> waiters = new Queue<TaskCompletionSource<T>>();

    public void Enqueue(T item)
    {
        if (waiters.Count > 0) waiters.Dequeue().SetResult(item);
        else items.Enqueue(item);
    }

    public Task<T> DequeueAsync()
    {
        if (items.Count > 0) return Task.FromResult(items.Dequeue());
        var waiter = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        waiters.Enqueue(waiter);
        return waiter.Task;
    }

    public int Waiting => waiters.Count;
}

public sealed class RateLimiter
{
    private readonly SemaphoreSlim gate;
    private int active, peak;
    public RateLimiter(int limit) { gate = new SemaphoreSlim(limit); }
    public int Peak => peak;

    public async Task<T> RunAsync<T>(Func<Task<T>> work)
    {
        await gate.WaitAsync();
        try
        {
            int now = Interlocked.Increment(ref active);
            int seen;
            while (now > (seen = Volatile.Read(ref peak)) && Interlocked.CompareExchange(ref peak, now, seen) != seen) { }
            return await work();
        }
        finally
        {
            Interlocked.Decrement(ref active);
            gate.Release();
        }
    }
}

public static class Program
{
    private static async Task<int> ProducerAsync(ChannelWriter<int> writer, int start, int count)
    {
        for (int i = 0; i < count; i++)
        {
            await writer.WriteAsync(start + i);
            await Task.Yield();
        }
        return count;
    }

    private static async Task<List<int>> ConsumerAsync(ChannelReader<int> reader)
    {
        var received = new List<int>();
        await foreach (int item in reader.ReadAllAsync()) received.Add(item);
        return received;
    }

    private static async Task<string> TimeoutAsync(Task<string> work, int milliseconds)
    {
        using var cancel = new CancellationTokenSource();
        var delay = Task.Delay(milliseconds, cancel.Token);
        var winner = await Task.WhenAny(work, delay);
        if (winner != work) return "timeout";
        cancel.Cancel();
        return await work;
    }

    private static async Task<string> SlowAsync(string value, int milliseconds, CancellationToken token = default)
    {
        await Task.Delay(milliseconds, token);
        return value;
    }

    public static async Task Main()
    {
        var channel = Channel.CreateBounded<int>(2);
        var consumer = ConsumerAsync(channel.Reader);
        var producers = new[] { ProducerAsync(channel.Writer, 100, 5), ProducerAsync(channel.Writer, 200, 3) };
        int produced = (await Task.WhenAll(producers)).Sum();
        channel.Writer.Complete();
        var received = await consumer;
        Console.WriteLine(produced + " " + received.Count + " " + received.Sum() + " " + string.Join(",", received.Where(n => n >= 200)) + " " + string.Join(",", received.Where(n => n < 200)) + " " + channel.Reader.Completion.IsCompleted);

        var queue = new AsyncQueue<string>();
        queue.Enqueue("ready");
        var immediate = queue.DequeueAsync();
        var pending1 = queue.DequeueAsync();
        var pending2 = queue.DequeueAsync();
        Console.Write(immediate.IsCompleted + " " + pending1.IsCompleted + " " + queue.Waiting + " ");
        queue.Enqueue("first");
        queue.Enqueue("second");
        Console.WriteLine(await immediate + " " + await pending1 + " " + await pending2 + " " + queue.Waiting);

        var limiter = new RateLimiter(2);
        var results = await Task.WhenAll(Enumerable.Range(1, 6).Select(n => limiter.RunAsync(async () => { await Task.Delay(5); return n * n; })));
        Console.WriteLine(string.Join(",", results) + " peak<=2: " + (limiter.Peak <= 2) + " peak>=1: " + (limiter.Peak >= 1));

        Console.WriteLine(await TimeoutAsync(SlowAsync("fast", 1), 2000) + " " + await TimeoutAsync(SlowAsync("slow", 2000), 20));
        using var source = new CancellationTokenSource();
        var cancellable = SlowAsync("never", 5000, source.Token);
        int callbacks = 0;
        using (source.Token.Register(() => callbacks++)) source.Cancel();
        try { await cancellable; }
        catch (OperationCanceledException e) { Console.WriteLine("cancelled " + cancellable.IsCanceled + " " + (e.CancellationToken == source.Token) + " " + callbacks + " " + cancellable.Status); }

        var order = new List<string>();
        var gate = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task WorkerAsync(string name, Task before)
        {
            await before;
            order.Add(name);
        }
        var a = WorkerAsync("a", gate.Task);
        var b = WorkerAsync("b", a);
        var c = WorkerAsync("c", b);
        order.Add("released");
        gate.SetResult(true);
        await c;
        Console.WriteLine(string.Join(">", order));

        var lazy = new Lazy<Task<int>>(async () => { await Task.Delay(2); return 7; });
        int[] twice = await Task.WhenAll(lazy.Value, lazy.Value);
        var progressLog = new List<int>();
        IProgress<int> progress = new SynchronousProgress<int>(progressLog.Add);
        for (int i = 0; i <= 100; i += 25) { await Task.Yield(); progress.Report(i); }
        var local = new AsyncLocal<string> { Value = "outer" };
        string inner = await Task.Run(async () => { string seen = local.Value; local.Value = "changed"; await Task.Yield(); return seen + "/" + local.Value; });
        Console.WriteLine(twice.Sum() + " " + string.Join(",", progressLog) + " " + inner + " " + local.Value);
        ValueTask<int> synchronous = new ValueTask<int>(5);
        ValueTask done = default;
        await done;
        Console.WriteLine(synchronous.IsCompleted + " " + await synchronous + " " + await Task.FromResult(1).ConfigureAwait(false) + " " + Task.WhenAll().IsCompleted + " " + (await Task.WhenAll(Array.Empty<Task<int>>())).Length);
    }
}

public sealed class SynchronousProgress<T> : IProgress<T>
{
    private readonly Action<T> handler;
    public SynchronousProgress(Action<T> handler) { this.handler = handler; }
    public void Report(T value) => handler(value);
}
