using System;
using System.Collections.Generic;
using System.Linq;

public class ResourceBase : IDisposable
{
    private bool disposed;
    protected readonly List<string> Log;
    public string Name { get; }
    public bool IsDisposed => disposed;

    public ResourceBase(string name, List<string> log) { Name = name; Log = log; }
    ~ResourceBase() { Dispose(false); }

    public void Dispose() { Dispose(true); GC.SuppressFinalize(this); }

    protected virtual void Dispose(bool disposing)
    {
        if (disposed) return;
        disposed = true;
        if (disposing) Log.Add("closed:" + Name);
    }

    protected void ThrowIfDisposed()
    {
        if (disposed) throw new ObjectDisposedException(Name);
    }
}

public sealed class BufferedFile : ResourceBase
{
    private List<int> buffer = new List<int>();
    public BufferedFile(string name, List<string> log) : base(name, log) { }
    public BufferedFile Write(int value) { ThrowIfDisposed(); buffer.Add(value); return this; }

    protected override void Dispose(bool disposing)
    {
        if (disposing && buffer != null)
        {
            Log.Add("flush:" + Name + "=" + buffer.Sum());
            buffer = null;
        }
        base.Dispose(disposing);
    }
}

public sealed class Defer : IDisposable
{
    private Action action;
    public Defer(Action action) { this.action = action; }
    public void Dispose() { Action run = action; action = null; run?.Invoke(); }
}

public sealed class Composite : IDisposable
{
    private readonly Stack<IDisposable> items = new Stack<IDisposable>();
    public T Add<T>(T item) where T : IDisposable { items.Push(item); return item; }

    public void Dispose()
    {
        List<Exception> errors = null;
        while (items.Count > 0)
        {
            try { items.Pop().Dispose(); }
            catch (Exception e) { (errors ??= new List<Exception>()).Add(e); }
        }
        if (errors != null) throw new AggregateException("dispose failed", errors);
    }
}

public sealed class Gate
{
    private readonly List<string> log;
    private readonly string name;
    private int depth;
    public Gate(string name, List<string> log) { this.name = name; this.log = log; }
    public int Depth => depth;
    public Guard Enter() { depth++; log.Add("lock:" + name + "@" + depth); return new Guard(this); }

    public readonly struct Guard : IDisposable
    {
        private readonly Gate gate;
        public Guard(Gate gate) { this.gate = gate; }
        public void Dispose() { gate.log.Add("unlock:" + gate.name + "@" + gate.depth); gate.depth--; }
    }
}

public sealed class TxScope : IDisposable
{
    private static TxScope current;
    private readonly TxScope parent;
    private readonly List<Action> undo = new List<Action>();
    private readonly List<string> log;
    private readonly string name;
    private bool completed;

    public TxScope(string name, List<string> log) { this.name = name; this.log = log; parent = current; current = this; log.Add("begin:" + name); }
    public static TxScope Current => current;
    public void Enlist(Action undoAction) => undo.Add(undoAction);
    public void Complete() => completed = true;

    public void Dispose()
    {
        current = parent;
        if (completed)
        {
            parent?.undo.AddRange(undo);
            log.Add((parent == null ? "commit:" : "merge:") + name + "(" + undo.Count + ")");
            return;
        }
        for (int i = undo.Count - 1; i >= 0; i--) undo[i]();
        log.Add("rollback:" + name + "(" + undo.Count + ")");
    }
}

public sealed class Ledger
{
    private readonly Dictionary<string, int> balances = new Dictionary<string, int> { ["cash"] = 100, ["bank"] = 50, ["loan"] = 0 };

    public void Move(string from, string to, int amount)
    {
        balances[from] -= amount;
        balances[to] += amount;
        TxScope.Current?.Enlist(() => { balances[from] += amount; balances[to] -= amount; });
        if (balances[from] < 0) throw new InvalidOperationException("insufficient funds in " + from);
    }

    public override string ToString() => string.Join(",", balances.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + "=" + p.Value));
}

public static class Program
{
    private static readonly List<string> log = new List<string>();
    private static string Drain() { string text = string.Join(" ", log); log.Clear(); return text; }

    private static TResult Use<TRes, TResult>(Func<TRes> open, Func<TRes, TResult> body) where TRes : IDisposable
    {
        using (TRes resource = open()) return body(resource);
    }

    private static bool Transfer(Ledger ledger, string name, bool completeInner, params (string From, string To, int Amount)[] moves)
    {
        try
        {
            using var outer = new TxScope(name, log);
            ledger.Move("bank", "cash", 10);
            using (var inner = new TxScope(name + ".inner", log))
            {
                foreach (var (from, to, amount) in moves) ledger.Move(from, to, amount);
                if (completeInner) inner.Complete();
            }
            outer.Complete();
            return true;
        }
        catch (InvalidOperationException e)
        {
            log.Add("error[" + e.Message + "]");
            return false;
        }
    }

    public static void Main()
    {
        var file = new BufferedFile("data", log);
        using (file) { file.Write(1).Write(2).Write(3); }
        file.Dispose();
        try { file.Write(4); }
        catch (ObjectDisposedException e) { log.Add("disposed:" + e.ObjectName + ":" + file.IsDisposed); }
        Console.WriteLine(Drain());

        ResourceBase asBase = new BufferedFile("virt", log).Write(40).Write(2);
        using (asBase) log.Add("virtual-dispatch");
        Console.WriteLine(Drain());
        Console.WriteLine("use=" + Use(() => new BufferedFile("gen", log), f => f.Write(7).Write(8).Name.Length) + " : " + Drain());

        var gateA = new Gate("A", log);
        var gateB = new Gate("B", log);
        using (gateA.Enter())
        using (gateB.Enter())
        {
            using var again = gateA.Enter();
            log.Add("depths=" + gateA.Depth + "/" + gateB.Depth);
        }
        Console.WriteLine(Drain() + " | depths=" + gateA.Depth + "/" + gateB.Depth);

        var ledger = new Ledger();
        Console.WriteLine("start    " + ledger);
        Console.WriteLine("t1 " + Transfer(ledger, "t1", true, ("cash", "loan", 30), ("bank", "loan", 5)) + " " + ledger);
        Console.WriteLine(Drain());
        Console.WriteLine("t2 " + Transfer(ledger, "t2", false, ("cash", "loan", 20)) + " " + ledger);
        Console.WriteLine(Drain());
        Console.WriteLine("t3 " + Transfer(ledger, "t3", true, ("cash", "bank", 15), ("loan", "cash", 500)) + " " + ledger);
        Console.WriteLine(Drain());
        Console.WriteLine("ambient cleared: " + (TxScope.Current == null));

        int counter = 0;
        try
        {
            using var composite = new Composite();
            composite.Add(new Defer(() => log.Add("first-registered:" + ++counter)));
            composite.Add(new Defer(() => throw new InvalidOperationException("second failed at " + ++counter)));
            composite.Add(new BufferedFile("third", log)).Write(9);
            composite.Add(new Defer(() => throw new NotSupportedException("fourth failed at " + ++counter)));
            log.Add("registered");
        }
        catch (AggregateException e)
        {
            log.Add(e.InnerExceptions.Count + " errors: " + string.Join(" / ", e.InnerExceptions.Select(x => x.GetType().Name + "=" + x.Message)));
        }
        Console.WriteLine(Drain());

        var once = new Defer(() => log.Add("ran-once"));
        once.Dispose();
        once.Dispose();
        Console.WriteLine(Drain() + " counter=" + counter);
    }
}
