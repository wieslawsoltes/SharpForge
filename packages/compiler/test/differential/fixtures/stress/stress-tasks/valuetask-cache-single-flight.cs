using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

var gates = new Dictionary<string, TaskCompletionSource<string>>();
int loads = 0;
var cache = new AsyncCache<string, string>(key =>
{
    loads++;
    return key.StartsWith("local:", StringComparison.Ordinal) ? Task.FromResult(key.Substring(6).ToUpperInvariant()) : (gates[key] = new TaskCompletionSource<string>()).Task;
});

ValueTask<string> a1 = cache.GetAsync("a");
ValueTask<string> a2 = cache.GetAsync("a");
ValueTask<string> b1 = cache.GetAsync("b");
Console.WriteLine("loads=" + loads + " a1.IsCompleted=" + a1.IsCompleted + " " + cache.Stats);
gates["a"].SetResult("value-of-a");
Console.WriteLine("a1=" + await a1 + " a2=" + await a2 + " b1.IsCompleted=" + b1.IsCompleted);
ValueTask<string> a3 = cache.GetAsync("a");
Console.WriteLine("a3 synchronous=" + a3.IsCompletedSuccessfully + " result=" + a3.Result + " " + cache.Stats);

ValueTask<string> b2 = cache.GetAsync("b");
gates["b"].SetException(new InvalidOperationException("backend down"));
foreach (ValueTask<string> waiter in new[] { b1, b2 })
{
    try { Console.WriteLine(await waiter); }
    catch (InvalidOperationException e) { Console.WriteLine("joined caller saw: " + e.Message + " faulted=" + waiter.IsFaulted); }
}
ValueTask<string> b3 = cache.GetAsync("b");
gates["b"].SetResult("value-of-b");
Console.WriteLine("failure not cached: b3=" + await b3 + " loads=" + loads + " " + cache.Stats);
ValueTask<string> local = cache.GetAsync("local:xyz");
Console.WriteLine("sync loader: completed=" + local.IsCompleted + " value=" + await local + " again=" + await cache.GetAsync("local:xyz") + " loads=" + loads + " " + cache.Stats);

var trace = new List<string>();
var slowGate = new TaskCompletionSource<int>();
async ValueTask<int> ParseOrFetchAsync(string text)
{
    if (int.TryParse(text, out int number)) return number;
    trace.Add("fetching " + text);
    int fetched = await slowGate.Task;
    trace.Add("fetched " + fetched);
    return fetched + text.Length;
}
ValueTask<int> fast = ParseOrFetchAsync("12");
ValueTask<int> slow = ParseOrFetchAsync("twelve");
Console.WriteLine("fast done=" + fast.IsCompletedSuccessfully + " slow done=" + slow.IsCompleted + " trace=" + string.Join(",", trace));
Task<int> slowTask = slow.AsTask();
slowGate.SetResult(100);
Console.WriteLine("fast=" + await fast + " slow=" + await slowTask + " again=" + await slowTask + " trace=" + string.Join(",", trace));

ValueTask<int> fromResult = ValueTask.FromResult(5);
ValueTask failed = ValueTask.FromException(new TimeoutException("vt failed"));
ValueTask cancelled = ValueTask.FromCanceled(new CancellationToken(true));
ValueTask<int> preserved = ParseOrFetchAsync("abc").Preserve();
Console.WriteLine(fromResult.Result + " " + failed.IsFaulted + " " + cancelled.IsCanceled + " " + default(ValueTask).IsCompletedSuccessfully + " " + ValueTask.CompletedTask.IsCompleted + " preserved=" + (await preserved + await preserved));
try { await failed; }
catch (TimeoutException e) { Console.WriteLine("awaited failed ValueTask: " + e.Message); }
try { await cancelled.ConfigureAwait(false); }
catch (OperationCanceledException e) { Console.WriteLine("awaited cancelled ValueTask: " + e.GetType().Name); }

var tally = new Tally();
int viaAsync = await tally.BumpTwiceAsync();
Console.WriteLine("struct async works on a copy: returned " + viaAsync + ", original " + tally.Count + ", sync bump " + tally.Bump() + ", original " + tally.Count);

var steps = new List<string>();
int ready = await new Ready<int>(7, true, steps);
string deferred = await new Ready<string>("later", false, steps);
Console.WriteLine("custom awaiter: " + ready + " " + deferred + " [" + string.Join(" ", steps) + "]");

var (count, name) = await (Task.FromResult(3), cache.GetAsync("a").AsTask());
Console.WriteLine("tuple await: " + count + " " + name);

int factoryRuns = 0;
var lazy = new AsyncLazy<int>(async () => { factoryRuns++; await Task.Yield(); return 40 + factoryRuns; });
Console.WriteLine("lazy started=" + lazy.Started + " runs=" + factoryRuns);
Console.WriteLine("lazy values " + await lazy + "," + await lazy + " started=" + lazy.Started + " runs=" + factoryRuns);

IAsyncShape[] shapes = { new Square(3), new Circle(2) };
double area = 0;
foreach (IAsyncShape shape in shapes) area += await shape.AreaAsync() + await shape.DoubledAsync();
Console.WriteLine("areas " + area.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) + " final " + cache.Stats);

sealed class AsyncCache<TKey, TValue>
{
    private readonly Dictionary<TKey, TValue> values = new Dictionary<TKey, TValue>();
    private readonly Dictionary<TKey, Task<TValue>> inflight = new Dictionary<TKey, Task<TValue>>();
    private readonly Func<TKey, Task<TValue>> loader;
    private int hits, joined, misses;
    public AsyncCache(Func<TKey, Task<TValue>> loader) { this.loader = loader; }
    public string Stats => "hits=" + hits + " joined=" + joined + " misses=" + misses + " inflight=" + inflight.Count;

    public ValueTask<TValue> GetAsync(TKey key)
    {
        if (values.TryGetValue(key, out TValue value)) { hits++; return new ValueTask<TValue>(value); }
        if (inflight.TryGetValue(key, out Task<TValue> pending)) { joined++; return new ValueTask<TValue>(pending); }
        misses++;
        Task<TValue> load = LoadAsync(key);
        if (!load.IsCompleted) inflight[key] = load;
        return new ValueTask<TValue>(load);
    }

    private async Task<TValue> LoadAsync(TKey key)
    {
        try
        {
            TValue value = await loader(key);
            values[key] = value;
            return value;
        }
        finally { inflight.Remove(key); }
    }
}

struct Tally
{
    public int Count;
    public int Bump() => ++Count;
    public async Task<int> BumpTwiceAsync() { Count++; await Task.Yield(); Count++; return Count; }
}

readonly struct Ready<T>
{
    private readonly T value;
    private readonly bool completed;
    private readonly List<string> steps;
    public Ready(T value, bool completed, List<string> steps) { this.value = value; this.completed = completed; this.steps = steps; }
    public Awaiter GetAwaiter() => new Awaiter(this);

    public readonly struct Awaiter : INotifyCompletion
    {
        private readonly Ready<T> owner;
        public Awaiter(Ready<T> owner) { this.owner = owner; }
        public bool IsCompleted { get { owner.steps.Add("IsCompleted=" + owner.completed); return owner.completed; } }
        public T GetResult() { owner.steps.Add("GetResult"); return owner.value; }
        public void OnCompleted(Action continuation) { owner.steps.Add("OnCompleted"); continuation(); }
    }
}

static class TupleAwait
{
    public static TaskAwaiter<(T1, T2)> GetAwaiter<T1, T2>(this (Task<T1>, Task<T2>) pair) => Both(pair.Item1, pair.Item2).GetAwaiter();
    private static async Task<(T1, T2)> Both<T1, T2>(Task<T1> first, Task<T2> second) => (await first, await second);
}

sealed class AsyncLazy<T>
{
    private readonly Lazy<Task<T>> lazy;
    public AsyncLazy(Func<Task<T>> factory) { lazy = new Lazy<Task<T>>(factory); }
    public bool Started => lazy.IsValueCreated;
    public TaskAwaiter<T> GetAwaiter() => lazy.Value.GetAwaiter();
}

interface IAsyncShape
{
    ValueTask<double> AreaAsync();
    async ValueTask<double> DoubledAsync() => 2 * await AreaAsync();
}

sealed record Square(double Side) : IAsyncShape
{
    public ValueTask<double> AreaAsync() => new ValueTask<double>(Side * Side);
}

sealed record Circle(double Radius) : IAsyncShape
{
    public async ValueTask<double> AreaAsync() { await Task.Yield(); return Math.Round(Math.PI * Radius * Radius, 2); }
}
