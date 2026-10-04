using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

public sealed class Stats
{
    private int _count, _peak, _flags;
    private long _total;
    private volatile bool _closed;
    private volatile string _status = "idle";

    public bool Closed => _closed;
    public string Status => _status;
    public int Count => Volatile.Read(ref _count);
    public long Total => Interlocked.Read(ref _total);
    public int Peak => _peak;
    public int Flags => _flags;

    public int Hit(long amount)
    {
        if (_closed) return -1;
        Interlocked.Add(ref _total, amount);
        return Interlocked.Increment(ref _count);
    }

    public void RecordPeak(int candidate)
    {
        int current;
        do
        {
            current = Volatile.Read(ref _peak);
            if (candidate <= current) return;
        } while (Interlocked.CompareExchange(ref _peak, candidate, current) != current);
    }

    public string SetStatus(string next) => Interlocked.Exchange(ref _status, next);
    public bool TryStatus(string expected, string next) => ReferenceEquals(Interlocked.CompareExchange(ref _status, next, expected), expected);
    public int Mark(int bit) => Interlocked.Or(ref _flags, bit);
    public int Unmark(int bit) => Interlocked.And(ref _flags, ~bit);
    public int Drain() => Interlocked.Exchange(ref _count, 0);
    public void Close() { _closed = true; Volatile.Write(ref _peak, -Interlocked.Decrement(ref _count)); }
}

public sealed class LockFreeStack<T>
{
    private sealed class Node { public T Value; public Node Next; }
    private Node _head;
    private int _count;
    public int Count => _count;

    public void Push(T value)
    {
        var node = new Node { Value = value };
        do { node.Next = Volatile.Read(ref _head); }
        while (Interlocked.CompareExchange(ref _head, node, node.Next) != node.Next);
        Interlocked.Increment(ref _count);
    }

    public bool TryPop(out T value)
    {
        Node head;
        do
        {
            head = Volatile.Read(ref _head);
            if (head == null) { value = default; return false; }
        } while (Interlocked.CompareExchange(ref _head, head.Next, head) != head);
        Interlocked.Decrement(ref _count);
        value = head.Value;
        return true;
    }
}

public sealed class Account
{
    public Account(int id, long balance) { Id = id; Balance = balance; }
    public int Id { get; }
    public long Balance { get; set; }
    public object Gate { get; } = new object();
}

public sealed class Bank
{
    private readonly object _audit = new object();
    private readonly List<string> _log = new List<string>();
    private long _moved;
    public long Moved => Interlocked.Read(ref _moved);
    public IReadOnlyList<string> Log { get { lock (_audit) { return _log.ToArray(); } } }

    private void Audit(string entry) { lock (_audit) { _log.Add(entry); } }

    public bool Transfer(Account from, Account to, long amount)
    {
        Account first = from.Id < to.Id ? from : to, second = from.Id < to.Id ? to : from;
        lock (first.Gate)
        {
            lock (second.Gate)
            {
                if (amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount));
                if (from.Balance < amount) { Audit($"declined {from.Id}->{to.Id} {amount}"); return false; }
                from.Balance -= amount;
                to.Balance += amount;
            }
        }
        Interlocked.Add(ref _moved, amount);
        Audit($"moved {from.Id}->{to.Id} {amount}");
        return true;
    }

    public bool TryWithdraw(Account account, long amount)
    {
        bool taken = false;
        try
        {
            Monitor.TryEnter(account.Gate, ref taken);
            if (!taken) { Audit("busy " + account.Id); return false; }
            if (account.Balance < amount) return false;
            account.Balance -= amount;
            return true;
        }
        finally { if (taken) Monitor.Exit(account.Gate); }
    }

    public void Deposit(Account account, long amount)
    {
        bool taken = false;
        Monitor.Enter(account.Gate, ref taken);
        try { account.Balance += amount; }
        finally { if (taken) Monitor.Exit(account.Gate); }
    }
}

public static class Program
{
    private static Stats _shared;

    private static T OnThread<T>(Func<T> body)
    {
        T result = default;
        var thread = new Thread(() => result = body());
        thread.Start();
        thread.Join();
        return result;
    }

    public static void Main()
    {
        var stats = new Stats();
        for (int worker = 1; worker <= 3; worker++)
        {
            int amount = worker * 10;
            int last = OnThread(() => { int hit = 0; for (int i = 0; i < 500; i++) hit = stats.Hit(amount); stats.RecordPeak(amount * 7 % 50); return hit; });
            Console.WriteLine($"worker {worker}: count {last} total {stats.Total} peak {stats.Peak}");
        }
        Console.WriteLine($"{stats.SetStatus("busy")} {stats.TryStatus("idle", "x")} {stats.TryStatus(stats.Status, "done")} {stats.Status} {stats.Mark(1)} {stats.Mark(4)} {stats.Mark(4)} {stats.Unmark(1)} {stats.Flags}");
        int drained = stats.Drain();
        bool closedSeen = OnThread(() => { stats.Hit(1); stats.Hit(1); stats.Close(); return stats.Closed; });
        Console.WriteLine($"{drained} {closedSeen} {stats.Closed} {stats.Count} {stats.Peak} {stats.Hit(5)} {stats.Total}");

        Stats winner = new Stats(), loser = new Stats();
        var installed = Interlocked.CompareExchange(ref _shared, winner, null);
        var second = OnThread(() => Interlocked.CompareExchange(ref _shared, loser, null));
        Console.WriteLine($"{installed is null} {ReferenceEquals(second, winner)} {ReferenceEquals(_shared, winner)} {ReferenceEquals(Interlocked.Exchange(ref _shared, loser), winner)} {ReferenceEquals(_shared, loser)}");

        var stack = new LockFreeStack<string>();
        foreach (string prefix in new[] { "a", "b", "c" })
            OnThread(() => { for (int i = 1; i <= 3; i++) stack.Push(prefix + i); return stack.Count; });
        var popped = new List<string>();
        int afterPush = stack.Count;
        OnThread(() => { while (popped.Count < 4 && stack.TryPop(out string item)) popped.Add(item); return 0; });
        while (stack.TryPop(out string item)) popped.Add(item);
        Console.WriteLine($"{afterPush} {string.Join(",", popped)} {stack.Count} {stack.TryPop(out string none)} {none ?? "null"}");

        var bank = new Bank();
        Account alice = new(1, 500), bob = new(2, 100), carol = new(3, 0);
        var plan = new (Account From, Account To, long Amount)[] { (alice, bob, 200), (bob, carol, 250), (carol, alice, 400), (bob, alice, 60), (carol, bob, 250) };
        foreach (var (from, to, amount) in plan)
            Console.WriteLine($"{from.Id}->{to.Id} {amount}: {OnThread(() => bank.Transfer(from, to, amount))} [{alice.Balance},{bob.Balance},{carol.Balance}]");
        bool whileHeld, entered, reentrant;
        lock (alice.Gate)
        {
            entered = Monitor.IsEntered(alice.Gate);
            whileHeld = OnThread(() => bank.TryWithdraw(alice, 10) || Monitor.IsEntered(alice.Gate));
            lock (alice.Gate) { reentrant = bank.TryWithdraw(alice, 10); }
        }
        bool afterRelease = OnThread(() => bank.TryWithdraw(alice, 10)), tooMuch = bank.TryWithdraw(alice, 10_000);
        Console.WriteLine($"{entered} {whileHeld} {reentrant} {afterRelease} {tooMuch} {Monitor.IsEntered(alice.Gate)} {alice.Balance}");
        try { bank.Transfer(alice, bob, -5); }
        catch (ArgumentOutOfRangeException e) { Console.WriteLine("rejected " + e.ParamName + " held=" + (Monitor.IsEntered(alice.Gate) || Monitor.IsEntered(bob.Gate))); }
        OnThread(() => { bank.Deposit(carol, 25); bank.Deposit(bob, 5); return bank.Transfer(bob, carol, 1); });
        Console.WriteLine($"total {alice.Balance + bob.Balance + carol.Balance} moved {bank.Moved} [{alice.Balance},{bob.Balance},{carol.Balance}]");
        foreach (string entry in bank.Log) Console.WriteLine("  " + entry);
        Console.WriteLine(bank.Log.Count(e => e.StartsWith("moved")) + " " + Monitor.TryEnter(carol.Gate, 0) + " " + Monitor.IsEntered(carol.Gate) + " " + OnThread(() => Monitor.TryEnter(carol.Gate)));
        Monitor.Exit(carol.Gate);
        Console.WriteLine(OnThread(() => { bool got = Monitor.TryEnter(carol.Gate, TimeSpan.Zero); if (got) Monitor.Exit(carol.Gate); return got; }));
    }
}
