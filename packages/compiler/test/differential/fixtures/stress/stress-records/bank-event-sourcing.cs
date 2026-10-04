using System;
using System.Collections.Generic;
using System.Linq;

public abstract record Event(int Sequence)
{
    public string Note { get; init; } = "";
    public abstract long Delta { get; }
}

public record Opened(int Sequence, string Owner, long Initial) : Event(Sequence)
{
    public override long Delta => Initial;
}

public record Deposited(int Sequence, long Amount) : Event(Sequence)
{
    public override long Delta => Amount;
}

public record Withdrawn(int Sequence, long Amount) : Event(Sequence)
{
    public override long Delta => -Amount;
}

public sealed record Transferred(int Sequence, long Amount, string Target) : Withdrawn(Sequence, Amount)
{
    public long Fee { get; init; }
    public override long Delta => base.Delta - Fee;
}

public sealed record Closed(int Sequence) : Event(Sequence)
{
    public override long Delta => 0;
    public override string ToString() => "Closed#" + Sequence;
}

public enum Status { Empty, Active, Frozen, Closed }

public readonly record struct Money(long Cents, string Currency)
{
    public override string ToString() => (Cents < 0 ? "-" : "") + Math.Abs(Cents) / 100 + "." + (Math.Abs(Cents) % 100).ToString("00") + " " + Currency;
    public static Money operator +(Money left, long cents) => left with { Cents = left.Cents + cents };
}

public sealed record Account(string Owner, Money Balance, Status Status, int Version)
{
    public static Account Initial { get; } = new Account("", new Money(0, "EUR"), Status.Empty, 0);

    private Account Next(Money balance, Status status) => this with { Balance = balance, Status = status, Version = Version + 1 };

    public Account Apply(Event change) => (this, change) switch
    {
        ({ Status: Status.Empty }, Opened(_, var owner, var initial)) => Next(Balance + initial, Status.Active) with { Owner = owner },
        ({ Status: Status.Empty or Status.Closed }, _) => throw new InvalidOperationException($"event {change.Sequence} on {Status} account"),
        ({ Status: Status.Active }, Transferred { Target: var target }) when target == Owner => throw new InvalidOperationException("self transfer"),
        ({ Status: Status.Active, Balance.Cents: var cents }, Withdrawn) when cents + change.Delta < 0 => Next(Balance, Status.Frozen),
        ({ Status: Status.Active }, Deposited or Withdrawn) => Next(Balance + change.Delta, Status.Active),
        ({ Status: Status.Frozen }, Deposited(_, var amount)) => Next(Balance + amount, Status.Active),
        ({ Status: Status.Frozen }, Withdrawn) => this,
        (_, Closed) => Next(Balance, Status.Closed),
        _ => throw new InvalidOperationException("unexpected " + change.GetType().Name),
    };
}

public static class Program
{
    private static string Kind(Event change) => change switch
    {
        Transferred(_, >= 10000, _) { Fee: 0 } => "big free transfer",
        Transferred t => "transfer to " + t.Target,
        Withdrawn(_, var amount) => amount > 5000 ? "large withdrawal" : "withdrawal",
        Deposited { Note: "salary" } => "salary",
        Deposited => "deposit",
        Opened or Closed => "lifecycle",
        _ => "other",
    };

    public static void Main()
    {
        var transfer = new Transferred(4, 3000, "bob") { Fee = 150, Note = "rent" };
        var log = new List<Event>
        {
            new Opened(1, "alice", 10000),
            new Deposited(2, 250050) { Note = "salary" },
            new Withdrawn(3, 4999),
            transfer,
            new Withdrawn(5, 900000),
            new Withdrawn(6, 100),
            new Deposited(7, 1),
            new Transferred(8, 20000, "carol"),
            new Closed(9),
        };
        var history = new List<Account> { Account.Initial };
        foreach (var change in log)
        {
            var next = history[^1].Apply(change);
            Console.WriteLine($"{change} [{Kind(change)}] -> {next.Balance} {next.Status} v{next.Version}{(ReferenceEquals(next, history[^1]) ? " (unchanged)" : "")}");
            history.Add(next);
        }
        Console.WriteLine(history[^1]);

        Event asEvent = transfer;
        Withdrawn asWithdrawn = transfer;
        var replay = asEvent with { Sequence = 99, Note = "replay" };
        var cheaper = asWithdrawn with { Amount = 1 };
        Console.WriteLine(replay.GetType().Name + " " + replay + " " + cheaper.Delta + " " + ((Transferred)cheaper).Fee + " " + transfer.Sequence);
        var plain = new Withdrawn(4, 3000) { Note = "rent" };
        Console.WriteLine((plain == asWithdrawn) + " " + plain.Equals(asWithdrawn) + " " + asWithdrawn.Equals(plain) + " " + (asWithdrawn == transfer with { })
            + " " + (transfer == transfer with { Fee = 151 }) + " " + (asEvent != replay with { Sequence = 4, Note = "rent" }) + " " + ReferenceEquals(transfer, transfer with { }));

        var unique = new HashSet<Event>(log) { new Withdrawn(3, 4999), new Withdrawn(3, 4999) { Note = "x" }, plain, transfer with { }, new Closed(9) };
        var perState = new Dictionary<Account, int>();
        foreach (var state in history) perState[state] = perState.TryGetValue(state, out int seen) ? seen + 1 : 1;
        Console.WriteLine(unique.Count + " " + perState.Count + " " + perState.Values.Max() + " " + perState[history[5] with { }] + " " + history.Distinct().Count()
            + " " + unique.Contains(new Opened(1, "alice", 10000)) + " " + unique.Contains(new Opened(1, "Alice", 10000)));

        var (owner, balance, status, version) = history[4];
        var (sequence, amount, target) = transfer;
        var (baseSequence, baseAmount) = (Withdrawn)transfer;
        var (cents, currency) = balance;
        Console.WriteLine($"{owner} {balance} {status} {version} | {sequence} {amount} {target} | {baseSequence} {baseAmount} | {cents} {currency}");

        foreach (var bad in new Event[] { new Deposited(1, 5), new Transferred(2, 5, "alice"), new Deposited(10, 1) })
        {
            var state = bad.Sequence switch { 1 => Account.Initial, 2 => history[1], _ => history[^1] };
            try { Console.WriteLine(state.Apply(bad)); }
            catch (InvalidOperationException e) { Console.WriteLine("rejected: " + e.Message); }
        }
        Console.WriteLine(string.Join(", ", log.GroupBy(Kind).OrderBy(g => g.Key, StringComparer.Ordinal).Select(g => g.Key + "=" + g.Sum(e => e.Delta))));
        Console.WriteLine(default(Money) == new Money(0, null) ? "default money " + new Money(-5, "USD") + " / " + (new Money(199, "PLN") + 1) : "?");
    }
}
