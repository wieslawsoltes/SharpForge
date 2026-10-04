using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

var clock = new FakeClock();
var log = new List<string>();
long origin = 0;
var limiter = new WindowLimiter(clock, limit: 2, window: 100);

async Task<int> DownloadAsync(string name, int chunks, CancellationToken token)
{
    await limiter.AcquireAsync(token);
    log.Add($"t={clock.Now - origin} start {name}");
    int bytes = 0;
    try
    {
        for (int i = 0; i < chunks; i++)
        {
            await clock.Delay(30, token);
            bytes += 100;
        }
        log.Add($"t={clock.Now - origin} done {name} {bytes}");
        return bytes;
    }
    catch (OperationCanceledException) when (token.IsCancellationRequested)
    {
        log.Add($"t={clock.Now - origin} cancelled {name} at {bytes}");
        throw;
    }
}

async Task TimeoutAsync(CancellationTokenSource source, long after)
{
    await clock.Delay(after);
    log.Add($"t={clock.Now - origin} timeout fires");
    source.Cancel();
}

Task<int>[] StartAll(CancellationToken token) =>
    new[] { ("a", 2), ("b", 4), ("c", 1), ("d", 2), ("e", 1) }.Select(job => DownloadAsync(job.Item1, job.Item2, token)).ToArray();

void Pump(params Task[] tasks)
{
    while (!tasks.All(t => t.IsCompleted)) clock.Advance(10);
}

Task<int>[] first = StartAll(CancellationToken.None);
Console.WriteLine("pending after start: " + first.Count(t => !t.IsCompleted) + ", timers=" + clock.PendingTimers);
Pump(first);
foreach (string line in log) Console.WriteLine(line);
Console.WriteLine("total=" + (await Task.WhenAll(first)).Sum() + " finished at t=" + clock.Now);
log.Clear();

clock.Advance(100 - clock.Now % 100);
origin = clock.Now;
using var deadline = new CancellationTokenSource();
Task timeout = TimeoutAsync(deadline, 140);
Task<int>[] second = StartAll(deadline.Token);
Pump(second);
Pump(timeout);
foreach (string line in log) Console.WriteLine("run2 " + line);
Console.WriteLine(string.Join(" ", second.Select(t => t.Status == TaskStatus.RanToCompletion ? t.Result.ToString() : t.Status.ToString())));
try { await Task.WhenAll(second); }
catch (OperationCanceledException e) { Console.WriteLine(e.GetType().Name + " token matches: " + (e.CancellationToken == deadline.Token)); }

var order = new List<string>();
using var source = new CancellationTokenSource();
source.Token.Register(() => order.Add("first"));
CancellationTokenRegistration removed = source.Token.Register(() => order.Add("second"));
source.Token.Register(state => order.Add((string)state), "third-with-state");
removed.Dispose();
order.Add("cancel");
source.Cancel();
source.Token.Register(() => order.Add("late-runs-immediately"));
Console.WriteLine(string.Join(" > ", order) + " | canBeCanceled " + source.Token.CanBeCanceled + "/" + CancellationToken.None.CanBeCanceled);

using var user = new CancellationTokenSource();
using var shutdown = new CancellationTokenSource();
using var linked = CancellationTokenSource.CreateLinkedTokenSource(user.Token, shutdown.Token);
shutdown.Cancel();
Console.WriteLine("linked=" + linked.IsCancellationRequested + " user=" + user.IsCancellationRequested + " shutdown=" + shutdown.IsCancellationRequested);
try { linked.Token.ThrowIfCancellationRequested(); }
catch (OperationCanceledException e) { Console.WriteLine(e.GetType().Name + " linked token: " + (e.CancellationToken == linked.Token) + ", user token: " + (e.CancellationToken == user.Token)); }

static int CountUntilCancelled(int cancelAt)
{
    using var cts = new CancellationTokenSource();
    int i = 0;
    try
    {
        for (; ; i++)
        {
            if (i == cancelAt) cts.Cancel();
            cts.Token.ThrowIfCancellationRequested();
        }
    }
    catch (OperationCanceledException) { return i; }
}
Console.WriteLine("cooperative loop stopped at " + CountUntilCancelled(7));

var completion = new TaskCompletionSource<int>();
Console.WriteLine(completion.TrySetCanceled(user.Token) + " " + completion.TrySetResult(1) + " " + completion.Task.Status);
try { Console.WriteLine(await completion.Task); }
catch (TaskCanceledException e) { Console.WriteLine("TaskCanceledException task matches: " + (e.Task == completion.Task)); }

static async Task<int> ThrowsAsync(bool cancel)
{
    await Task.Yield();
    if (cancel) throw new OperationCanceledException("gave up");
    throw new TimeoutException("too slow");
}
foreach (bool cancel in new[] { true, false })
{
    Task<int> task = ThrowsAsync(cancel);
    try { await task; }
    catch (Exception e) { Console.WriteLine(e.GetType().Name + " -> " + task.Status + " (" + e.Message + ") exception null: " + (task.Exception == null)); }
}

Task early = clock.Delay(10, source.Token);
Console.WriteLine("delay with cancelled token: " + early.Status + ", timers=" + clock.PendingTimers);

sealed class FakeClock
{
    private readonly List<(long Due, TaskCompletionSource<bool> Source, CancellationTokenRegistration Registration)> timers = new();
    public long Now { get; private set; }
    public int PendingTimers => timers.Count(t => !t.Source.Task.IsCompleted);

    public Task Delay(long milliseconds, CancellationToken token = default)
    {
        if (token.IsCancellationRequested) return Task.FromCanceled(token);
        var source = new TaskCompletionSource<bool>();
        timers.Add((Now + milliseconds, source, token.Register(() => source.TrySetCanceled(token))));
        return source.Task;
    }

    public void Advance(long milliseconds)
    {
        long target = Now + milliseconds;
        while (true)
        {
            int next = -1;
            for (int i = 0; i < timers.Count; i++)
                if (timers[i].Due <= target && (next < 0 || timers[i].Due < timers[next].Due)) next = i;
            if (next < 0) break;
            var timer = timers[next];
            timers.RemoveAt(next);
            Now = Math.Max(Now, timer.Due);
            timer.Registration.Dispose();
            timer.Source.TrySetResult(true);
        }
        Now = target;
    }
}

sealed class WindowLimiter
{
    private readonly FakeClock clock;
    private readonly int limit;
    private readonly long window;
    private long windowStart;
    private int used;
    public WindowLimiter(FakeClock clock, int limit, long window) { this.clock = clock; this.limit = limit; this.window = window; }

    public async ValueTask AcquireAsync(CancellationToken token)
    {
        while (true)
        {
            token.ThrowIfCancellationRequested();
            if (clock.Now >= windowStart + window) { windowStart = clock.Now - clock.Now % window; used = 0; }
            if (used < limit) { used++; return; }
            await clock.Delay(windowStart + window - clock.Now, token);
        }
    }
}
