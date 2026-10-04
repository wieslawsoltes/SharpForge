using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

int built = 0, attempts = 0, retries = 0;
var settings = new Lazy<Dictionary<string, int>>(() => { built++; return new Dictionary<string, int> { ["workers"] = 4 }; });
var failing = new Lazy<int>(() => { attempts++; throw new InvalidOperationException("boom " + attempts); });
var retrying = new Lazy<int>(() => ++retries < 3 ? throw new InvalidOperationException("retry " + retries) : retries * 14, LazyThreadSafetyMode.PublicationOnly);
var constant = new Lazy<string>("ready");
var defaulted = new Lazy<Pool<Buffer>>();
Console.WriteLine($"{settings.IsValueCreated} {built} {constant.IsValueCreated} {constant.Value} {defaulted.IsValueCreated}");
int fromThread = Run(() => settings.Value["workers"]++);
Console.WriteLine($"{fromThread} {settings.Value["workers"]} {settings.IsValueCreated} {built} {Run(() => settings.Value.Count)} {built}");
var outcomes = new List<string>();
for (int i = 0; i < 3; i++)
{
    try { outcomes.Add("value " + failing.Value); } catch (InvalidOperationException e) { outcomes.Add(e.Message); }
    try { outcomes.Add("value " + retrying.Value); } catch (InvalidOperationException e) { outcomes.Add(e.Message); }
}
for (int i = 0; i < outcomes.Count; i += 2) Console.WriteLine($"attempt {i / 2 + 1}: cached={outcomes[i]} publication-only={outcomes[i + 1]}");
Console.WriteLine($"{attempts} {retries} {failing.IsValueCreated} {retrying.IsValueCreated} {retrying.Value}");

int factoryCalls = 0;
using (var local = new ThreadLocal<int>(() => ++factoryCalls * 100, trackAllValues: true))
{
    bool before = local.IsValueCreated;
    local.Value += 5;
    int onThread = Run(() => { int seen = local.Value; local.Value = seen + 1; return local.Value; });
    int untouched = Run(() => local.IsValueCreated ? 1 : 0);
    Console.WriteLine($"{before} {local.Value} {onThread} {untouched} {factoryCalls} {string.Join(",", local.Values.OrderBy(v => v))} {local.IsValueCreated}");
}
Scope.Enter("main");
string nested = Scope.Describe();
string other = Run(() => Scope.Describe() + "|" + Scope.Enter("worker") + "|" + Scope.Describe());
Console.WriteLine($"{nested} / {other} / {Scope.Describe()} / {Scope.Enter("again")} {Scope.Shared}");

var cache = new Cache();
Console.WriteLine($"{cache.GetOrAdd("a", 1)} {cache.GetOrAdd("b", 2)} {cache.GetOrAdd("a", 99)} {cache.TryGet("b", out int b)}:{b} {cache.TryGet("z", out int z)}:{z} writes={cache.Writes} {cache.State()}");
Console.WriteLine(cache.Probe());
Console.WriteLine(Run(() => cache.GetOrAdd("c", 3) + cache.GetOrAdd("a", 0)) + " " + cache.Writes + " " + cache.Recursion());

var pool = new Pool<Buffer>(capacity: 2);
string leased;
using (var first = pool.Rent())
using (var second = pool.Rent())
{
    first.Item.Data[0] = 7;
    using var third = pool.Rent();
    leased = $"{first.Item.Id}{second.Item.Id}{third.Item.Id} idle={pool.Idle} created={pool.Created}";
}
Console.WriteLine($"{leased} -> idle={pool.Idle} dropped={pool.Dropped}");
int reused = Run(() => { using var lease = pool.Rent(); return lease.Item.Id * 10 + lease.Item.Data[0]; });
using (var again = pool.Rent()) Console.WriteLine($"{reused} {again.Item.Id} {again.Item.Data[0]} idle={pool.Idle} created={pool.Created} rented={pool.Rented}");
Console.WriteLine($"idle={pool.Idle} {defaulted.Value.Rent().Item.Id > 0} {defaulted.IsValueCreated} {defaulted.Value.Idle}");

var queue = new ConcurrentQueue<int>();
var seenBy = new ConcurrentDictionary<string, int>();
using var ready = new ManualResetEventSlim(false);
using var slots = new SemaphoreSlim(2, 2);
using var pending = new CountdownEvent(3);
foreach (string name in new[] { "x", "y", "x" })
{
    Run(() =>
    {
        queue.Enqueue(seenBy.AddOrUpdate(name, 1, (_, old) => old + 1) * (name == "x" ? 1 : 10));
        return pending.Signal();
    });
}
bool gotOne = slots.Wait(0), gotTwo = slots.Wait(0), gotThree = Run(() => slots.Wait(0));
ready.Set();
Console.WriteLine($"{string.Join(",", queue)} {queue.TryDequeue(out int head)}:{head} {queue.Count} {seenBy["x"]}{seenBy.GetOrAdd("z", 0)}{seenBy.Count} {pending.IsSet} {gotOne}{gotTwo}{gotThree} {slots.Release(2)} {slots.CurrentCount} {Run(() => ready.Wait(0))} {ready.IsSet}");

static T Run<T>(Func<T> body)
{
    T result = default;
    var thread = new Thread(() => result = body());
    thread.Start();
    thread.Join();
    return result;
}

public sealed class Buffer
{
    private static int _next;
    public int Id { get; } = Interlocked.Increment(ref _next);
    public int[] Data { get; } = new int[4];
}

public sealed class Pool<T> where T : class, new()
{
    private readonly Stack<T> _idle = new Stack<T>();
    private readonly object _gate = new object();
    private readonly int _capacity;
    private int _created, _rented, _dropped;
    public Pool() : this(1) { }
    public Pool(int capacity) { _capacity = capacity; }
    public int Created => _created;
    public int Rented => _rented;
    public int Dropped => _dropped;
    public int Idle { get { lock (_gate) { return _idle.Count; } } }

    public Lease Rent()
    {
        T item = null;
        lock (_gate) { if (_idle.Count > 0) item = _idle.Pop(); }
        if (item == null) { item = new T(); Interlocked.Increment(ref _created); }
        Interlocked.Increment(ref _rented);
        return new Lease(this, item);
    }

    private void Return(T item)
    {
        lock (_gate)
        {
            if (_idle.Count < _capacity) { _idle.Push(item); return; }
        }
        Interlocked.Increment(ref _dropped);
    }

    public readonly struct Lease : IDisposable
    {
        private readonly Pool<T> _owner;
        public Lease(Pool<T> owner, T item) { _owner = owner; Item = item; }
        public T Item { get; }
        public void Dispose() => _owner.Return(Item);
    }
}

public static class Scope
{
    [ThreadStatic] private static int _depth;
    [ThreadStatic] private static string _name;
    public static int Shared;
    public static int Enter(string name) { _name = name; Shared++; return ++_depth; }
    public static string Describe() => (_name ?? "<none>") + ":" + _depth;
}

public sealed class Cache
{
    private readonly ReaderWriterLockSlim _lock = new ReaderWriterLockSlim();
    private readonly ReaderWriterLockSlim _recursive = new ReaderWriterLockSlim(LockRecursionPolicy.SupportsRecursion);
    private readonly Dictionary<string, int> _items = new Dictionary<string, int>();
    public int Writes { get; private set; }
    public string State() => $"r{(_lock.IsReadLockHeld ? 1 : 0)}u{(_lock.IsUpgradeableReadLockHeld ? 1 : 0)}w{(_lock.IsWriteLockHeld ? 1 : 0)}c{_lock.CurrentReadCount}";

    public bool TryGet(string key, out int value)
    {
        _lock.EnterReadLock();
        try { return _items.TryGetValue(key, out value); }
        finally { _lock.ExitReadLock(); }
    }

    public int GetOrAdd(string key, int value)
    {
        _lock.EnterUpgradeableReadLock();
        try
        {
            if (_items.TryGetValue(key, out int existing)) return existing;
            _lock.EnterWriteLock();
            try { _items[key] = value; Writes++; return value; }
            finally { _lock.ExitWriteLock(); }
        }
        finally { _lock.ExitUpgradeableReadLock(); }
    }

    public string Probe()
    {
        var parts = new List<string>();
        T Other<T>(Func<T> body) { T result = default; var thread = new Thread(() => result = body()); thread.Start(); thread.Join(); return result; }
        _lock.EnterReadLock();
        parts.Add(State() + " reader:" + Other(() => { bool ok = _lock.TryEnterReadLock(0); if (ok) _lock.ExitReadLock(); return ok; }) + " writer:" + Other(() => _lock.TryEnterWriteLock(0)));
        try { _lock.EnterReadLock(); } catch (LockRecursionException) { parts.Add("no recursion"); }
        _lock.ExitReadLock();
        _lock.EnterWriteLock();
        parts.Add(State() + " reader:" + Other(() => _lock.TryEnterReadLock(0)) + " upgrade:" + Other(() => _lock.TryEnterUpgradeableReadLock(TimeSpan.Zero)));
        _lock.ExitWriteLock();
        parts.Add(State() + " writer:" + Other(() => { bool ok = _lock.TryEnterWriteLock(0); if (ok) _lock.ExitWriteLock(); return ok; }));
        return string.Join("; ", parts);
    }

    public string Recursion()
    {
        _recursive.EnterWriteLock();
        _recursive.EnterWriteLock();
        _recursive.EnterReadLock();
        string held = $"{_recursive.RecursiveWriteCount}/{_recursive.RecursiveReadCount}/{_recursive.RecursionPolicy}";
        _recursive.ExitReadLock();
        _recursive.ExitWriteLock();
        _recursive.ExitWriteLock();
        return held + "/" + _recursive.IsWriteLockHeld;
    }
}
