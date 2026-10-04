using System;
using System.Collections.Generic;
using System.Threading.Tasks;

// Reduced from stress-dispose/async-dispose-pool: `await using` over a type that has an accessible `DisposeAsync`
// without implementing IAsyncDisposable - a statement over an expression or a declaration, a declaration, null.
var log = new List<string>();
await using (new Flusher(log, "expr")) { log.Add("pattern-body"); }
await using (var named = new Flusher(log, "named")) { log.Add("named-body"); }
{
    await using var declared = new Flusher(log, "declared");
    await using var valued = new ValueFlusher(log);
    log.Add("declared-body");
}
Flusher none = null;
await using (none) { log.Add("null-ok"); }
Console.WriteLine(string.Join(" ", log));

sealed class Flusher
{
    private readonly List<string> log;
    private readonly string name;
    public Flusher(List<string> log, string name) { this.log = log; this.name = name; }
    public async Task DisposeAsync() { await Task.Yield(); log.Add("flushed:" + name); }
}

struct ValueFlusher
{
    private readonly List<string> log;
    public ValueFlusher(List<string> log) { this.log = log; }
    public ValueTask DisposeAsync(int unused = 0) { log.Add("value-flushed"); return default; }
}
