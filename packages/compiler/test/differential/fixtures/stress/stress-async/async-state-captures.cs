using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

public struct Counter
{
    public int Value;
    public void Increment() => Value++;
}

public sealed class Account
{
    private decimal balance;
    private readonly List<string> history = new List<string>();
    public decimal Balance => balance;
    public IReadOnlyList<string> History => history;

    public async Task<bool> TransferAsync(Account target, decimal amount)
    {
        await Task.Yield();
        if (amount > balance)
        {
            history.Add($"rejected {amount}");
            return false;
        }
        balance -= amount;
        await target.DepositAsync(amount);
        history.Add($"sent {amount}");
        return true;
    }

    public async Task DepositAsync(decimal amount)
    {
        decimal before = balance;
        await Task.Delay(1);
        balance = before + amount;
        history.Add($"received {amount}");
    }
}

public static class Program
{
    private static async Task<int> SpillAsync(int a, int b)
    {
        int result = a + await Task.FromResult(b) * (await DelayedAsync(a) + b) - await DelayedAsync(await DelayedAsync(1));
        int[] array = { 1, 2, 3 };
        array[await DelayedAsync(1)] += await DelayedAsync(10);
        array[0] = array[2] + await DelayedAsync(array[1]);
        string text = $"{await DelayedAsync(1)}-{array[1]}-{await DelayedAsync(2)}";
        return result + array.Sum() + text.Length + Add(await DelayedAsync(3), b, await DelayedAsync(4));
    }

    private static int Add(int x, int y, int z) => x * 100 + y * 10 + z;

    private static async Task<int> DelayedAsync(int value)
    {
        await Task.Yield();
        return value;
    }

    private static async Task<string> StructStateAsync()
    {
        var counter = new Counter();
        var tuple = (Count: 0, Label: "t");
        Span<int> before = stackalloc int[2];
        before[0] = 5;
        int seed = before[0];
        for (int i = 0; i < 3; i++)
        {
            counter.Increment();
            tuple.Count += await DelayedAsync(i);
            counter.Value += await DelayedAsync(seed);
            tuple.Label += i;
        }
        return counter.Value + "/" + tuple;
    }

    private static async Task<string> BranchesAsync(int n)
    {
        var builder = new StringBuilder();
        if (n > 0 && await DelayedAsync(n) % 2 == 0) builder.Append("even ");
        else if (n < 0 || await DelayedAsync(n) == 0) builder.Append("non-positive ");
        builder.Append(n > 2 ? await DelayedAsync(n * 2) : -1);
        builder.Append(await DelayedAsync(n) switch { 0 => " zero", 1 => " one", var other when other > 3 => " many", _ => " few" });
        int? maybe = n == 3 ? null : await DelayedAsync(n);
        builder.Append(' ').Append(maybe ?? await DelayedAsync(-99));
        while (n > 0 && await DelayedAsync(n--) > 2) builder.Append('.');
        do builder.Append('!'); while (await DelayedAsync(n--) > 0);
        return builder.ToString();
    }

    private static async Task<List<string>> ClosuresAsync()
    {
        var results = new List<string>();
        var deferred = new List<Func<Task<string>>>();
        for (int i = 0; i < 3; i++)
        {
            int copy = i;
            await Task.Yield();
            deferred.Add(async () => { await Task.Yield(); return $"{copy}:{i}"; });
        }
        foreach (var item in new[] { "x", "y" })
        {
            string local = item + await DelayedAsync(1);
            deferred.Add(() => Task.FromResult(local + item));
        }
        foreach (var work in deferred) results.Add(await work());
        int shared = 0;
        async Task BumpAsync(int by) { await Task.Yield(); shared += by; }
        await BumpAsync(1);
        await Task.WhenAll(BumpAsync(10).ContinueWith(_ => { }), Task.CompletedTask);
        await BumpAsync(100);
        results.Add("shared=" + shared);
        return results;
    }

    private static async IAsyncEnumerable<int> CountdownAsync(int from)
    {
        while (from > 0)
        {
            await Task.Yield();
            yield return from--;
        }
    }

    public static async Task<int> Main(string[] args)
    {
        Console.WriteLine(await SpillAsync(2, 3) + " " + await SpillAsync(0, 0) + " " + args.Length);
        Console.WriteLine(await StructStateAsync());
        foreach (int n in new[] { -1, 0, 1, 2, 3, 4, 6 }) Console.Write("[" + await BranchesAsync(n) + "] ");
        Console.WriteLine();
        Console.WriteLine(string.Join(" ", await ClosuresAsync()));

        var alice = new Account();
        var bob = new Account();
        await alice.DepositAsync(100);
        bool[] outcomes = { await alice.TransferAsync(bob, 30), await alice.TransferAsync(bob, 80), await bob.TransferAsync(alice, 30), await bob.TransferAsync(bob, 0) };
        Console.WriteLine(string.Join(",", outcomes) + " " + alice.Balance + "/" + bob.Balance + " " + string.Join(";", alice.History) + " | " + string.Join(";", bob.History));

        var lazy = new Lazy<Task<int>>(() => DelayedAsync(42));
        var dictionary = new Dictionary<string, Task<int>> { ["a"] = DelayedAsync(1), ["b"] = DelayedAsync(2) };
        int total = 0;
        foreach (var (key, task) in dictionary) total += key.Length + await task;
        await foreach (int tick in CountdownAsync(3)) total = total * 10 + tick;
        object boxed = await DelayedAsync(7);
        object nothing = null;
        Console.WriteLine(await lazy.Value + await lazy.Value + " " + total + " " + (boxed is int seven && seven == await DelayedAsync(7)) + " " + (nothing == null));
        return total % 256;
    }
}
