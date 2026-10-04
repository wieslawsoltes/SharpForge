using System;
using System.Collections.Generic;
using System.Threading.Tasks;

var log = new List<string>();
var pool = new Pool(2, log);

string Drain() { string text = string.Join(" ", log); log.Clear(); return text; }

async IAsyncEnumerable<int> ReadRowsAsync(string owner, int count)
{
    await using var lease = await pool.RentAsync(owner);
    try
    {
        for (int i = 1; i <= count; i++)
        {
            await Task.Yield();
            yield return lease.Conn.Id * 100 + i;
        }
        log.Add("rows-done");
    }
    finally { log.Add("rows-finally"); }
}

async Task<int> SumRowsAsync(int count, int limit)
{
    int sum = 0;
    await foreach (int row in ReadRowsAsync("reader", count))
    {
        if (row % 100 > limit) break;
        sum += row;
    }
    return sum;
}

IEnumerable<string> Lines(string name, int count)
{
    using var audit = new Audit(name, log);
    for (int i = 0; i < count; i++) yield return name + i;
}

async Task<string> NestedAsync(bool failInner)
{
    await using var outer = new Audit("outer", log);
    await using (var inner = new Audit("inner", log) { FailOnDispose = failInner })
    {
        await Task.Yield();
        if (!failInner) return "early:" + inner.Name;
    }
    return "late:" + outer.Name;
}

await using (var lease1 = await pool.RentAsync("alpha"))
await using (var lease2 = await pool.RentAsync("beta"))
{
    log.Add("work:" + lease1.Conn.Id + "+" + lease2.Conn.Id + " free=" + pool.Free);
}
Console.WriteLine(Drain() + " | free=" + pool.Free);

try
{
    await using var a = await pool.RentAsync("a");
    await using var b = await pool.RentAsync("b");
    await using var c = await pool.RentAsync("c");
    log.Add("three leases");
}
catch (InvalidOperationException e) { log.Add("caught:" + e.Message); }
Console.WriteLine(Drain() + " | free=" + pool.Free);

Console.WriteLine("sum(all)=" + await SumRowsAsync(3, 9) + " : " + Drain());
Console.WriteLine("sum(break)=" + await SumRowsAsync(5, 2) + " : " + Drain());

var cfg = new Audit("cfg", log);
await using (cfg.ConfigureAwait(false)) { log.Add("configured-body"); }
Console.WriteLine(Drain());
await using (var both = new Audit("both", log)) { log.Add("await-using:" + both.Name); }
using (var both = new Audit("both", log)) { log.Add("using:" + both.Name); }
Console.WriteLine(Drain());

await using (var ticker = new Ticker(log))
{
    ticker.Tick();
    await Task.Yield();
    ticker.Tick();
    ticker.Tick();
}
Audit nothing = null;
await using (nothing) { log.Add("null-ok"); }
await using (new Flusher(log, "expr")) { log.Add("pattern-body"); }
Console.WriteLine(Drain());

try
{
    await using var faulty = new Audit("faulty", log) { FailOnDispose = true };
    await using var fine = new Audit("fine", log);
    log.Add("body");
}
catch (InvalidOperationException e) { log.Add("caught:" + e.Message); }
Console.WriteLine(Drain());

Console.WriteLine(await NestedAsync(false) + " : " + Drain());
try { Console.WriteLine(await NestedAsync(true)); }
catch (InvalidOperationException e) { Console.WriteLine("nested failed: " + e.Message + " : " + Drain()); }

Console.WriteLine(string.Join(",", Lines("L", 3)) + " : " + Drain());
foreach (string line in Lines("M", 4)) { if (line == "M1") break; log.Add(line); }
Console.WriteLine(Drain());

var uses = new List<string>();
for (int round = 0; round < 3; round++)
{
    await using var lease = await pool.RentAsync("round" + round);
    if (round == 1) continue;
    uses.Add(lease.Conn.Id + "x" + lease.Conn.Uses);
}
Console.WriteLine(string.Join(" ", uses) + " | " + Drain());
Console.WriteLine("free=" + pool.Free + " returned=" + pool.Returned);

sealed class Conn { public int Id; public int Uses; }

sealed class Pool
{
    private readonly Stack<Conn> free = new Stack<Conn>();
    private readonly List<string> log;
    public Pool(int size, List<string> log)
    {
        this.log = log;
        for (int id = size; id >= 1; id--) free.Push(new Conn { Id = id });
    }
    public int Free => free.Count;
    public int Returned { get; private set; }

    public async ValueTask<Lease> RentAsync(string owner)
    {
        await Task.Yield();
        if (free.Count == 0) throw new InvalidOperationException("pool exhausted for " + owner);
        Conn conn = free.Pop();
        conn.Uses++;
        log.Add("rent:" + owner + "#" + conn.Id);
        return new Lease(this, conn, owner);
    }

    public sealed class Lease : IAsyncDisposable
    {
        private readonly Pool pool;
        private readonly string owner;
        private bool returned;
        public Conn Conn { get; }
        public Lease(Pool pool, Conn conn, string owner) { this.pool = pool; Conn = conn; this.owner = owner; }

        public async ValueTask DisposeAsync()
        {
            if (returned) return;
            returned = true;
            await Task.Yield();
            pool.free.Push(Conn);
            pool.Returned++;
            pool.log.Add("return:" + owner + "#" + Conn.Id);
        }
    }
}

sealed class Audit : IDisposable, IAsyncDisposable
{
    private readonly List<string> log;
    public string Name { get; }
    public bool FailOnDispose { get; init; }
    public Audit(string name, List<string> log) { Name = name; this.log = log; log.Add("open:" + name); }
    public void Dispose() => log.Add("dispose:" + Name);
    public ValueTask DisposeAsync()
    {
        if (FailOnDispose) return ValueTask.FromException(new InvalidOperationException(Name + " failed to close"));
        log.Add("disposeAsync:" + Name);
        return ValueTask.CompletedTask;
    }
}

struct Ticker : IAsyncDisposable
{
    private readonly List<string> log;
    private int ticks;
    public Ticker(List<string> log) { this.log = log; ticks = 0; }
    public void Tick() => ticks++;
    public ValueTask DisposeAsync() { log.Add("ticker:" + ticks); return default; }
}

sealed class Flusher
{
    private readonly List<string> log;
    private readonly string name;
    public Flusher(List<string> log, string name) { this.log = log; this.name = name; }
    public async Task DisposeAsync() { await Task.Yield(); log.Add("flushed:" + name); }
}
