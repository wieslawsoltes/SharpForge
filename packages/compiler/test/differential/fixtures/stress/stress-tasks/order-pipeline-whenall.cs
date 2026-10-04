using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

public sealed record Order(int Id, string Sku, int Quantity);
public sealed record Priced(Order Order, decimal Total);

public interface IStage<TIn, TOut>
{
    string Name { get; }
    Task<TOut> RunAsync(TIn input);

    async Task<List<TOut>> RunManyAsync(IEnumerable<TIn> inputs)
    {
        var results = new List<TOut>();
        foreach (TIn input in inputs) results.Add(await RunAsync(input));
        return results;
    }
}

public sealed class Stage<TIn, TOut> : IStage<TIn, TOut>
{
    private readonly Func<TIn, Task<TOut>> body;
    private int calls;
    public Stage(string name, Func<TIn, Task<TOut>> body) { Name = name; this.body = body; }
    public string Name { get; }
    public int Calls => calls;
    public Task<TOut> RunAsync(TIn input) { Interlocked.Increment(ref calls); return body(input); }
}

public sealed class Repository<TKey, TValue>
{
    private readonly Dictionary<TKey, TValue> items;
    public Repository(Dictionary<TKey, TValue> items) { this.items = items; }

    public async Task<TValue> GetAsync(TKey key)
    {
        await Task.Yield();
        return items.TryGetValue(key, out TValue value) ? value : throw new KeyNotFoundException("no entry for " + key);
    }

    public Task<TValue[]> GetManyAsync(params TKey[] keys) => Task.WhenAll(keys.Select(GetAsync));
}

public readonly struct PriceRule
{
    private readonly decimal rate;
    public PriceRule(decimal rate) { this.rate = rate; }
    public async Task<decimal> ApplyAsync(decimal amount) { await Task.Yield(); return amount * rate; }
}

public static class Program
{
    private static string Money(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);

    private static async Task<string> OutcomeAsync(Task task)
    {
        try { await task; return "ok"; }
        catch (Exception e) { return e.GetType().Name + "/" + task.Status; }
    }

    public static async Task<int> Main()
    {
        Task done = Task.CompletedTask;
        Task<int> ready = Task.FromResult(42);
        Task<int> broken = Task.FromException<int>(new InvalidOperationException("broken from the start"));
        Task<int> cancelled = Task.FromCanceled<int>(new CancellationToken(true));
        Console.WriteLine(done.Status + " " + ready.Status + "=" + ready.Result + " " + broken.Status + " " + cancelled.Status);
        Console.WriteLine(done.IsCompletedSuccessfully + " " + broken.IsFaulted + " '" + broken.Exception.InnerException.Message + "' " + cancelled.IsCanceled + " " + (cancelled.Exception == null));

        var sources = Enumerable.Range(0, 4).Select(_ => new TaskCompletionSource<string>()).ToArray();
        Task<string[]> joined = Task.WhenAll(sources.Select(s => s.Task));
        var progress = new List<string>();
        for (int i = sources.Length - 1; i >= 0; i--)
        {
            sources[i].SetResult("r" + i);
            progress.Add(i + ":" + joined.IsCompleted);
        }
        Console.WriteLine("completed in reverse " + string.Join(" ", progress) + " -> " + string.Join(",", await joined));

        var slots = new[] { "a", "b", "c" }.ToDictionary(name => name, _ => new TaskCompletionSource<int>());
        var pending = new List<Task<int>> { slots["a"].Task, slots["b"].Task, slots["c"].Task };
        var arrivals = new List<string>();
        foreach (string name in new[] { "b", "c", "a" })
        {
            slots[name].SetResult(name[0] - 'a' + 1);
            Task<int> winner = await Task.WhenAny(pending);
            pending.Remove(winner);
            arrivals.Add(name + "=" + await winner + "(left " + pending.Count + ")");
        }
        Console.WriteLine("as completed: " + string.Join(" ", arrivals));

        var never = new TaskCompletionSource<int>();
        Task<int> firstOfDone = await Task.WhenAny(Task.FromResult(1), Task.FromResult(2));
        Task<int> skipsPending = await Task.WhenAny(never.Task, ready);
        Task<int> faultedWins = await Task.WhenAny(never.Task, broken);
        Console.WriteLine("WhenAny: " + firstOfDone.Result + " " + skipsPending.Result + " " + faultedWins.Status + " never=" + never.Task.Status);

        Console.WriteLine("WhenAll mixed: " + await OutcomeAsync(Task.WhenAll(ready, broken, cancelled)) + ", cancelled only: " + await OutcomeAsync(Task.WhenAll(ready, cancelled))
            + ", none: " + await OutcomeAsync(Task.WhenAll(new List<Task>())) + ", plain: " + await OutcomeAsync(Task.WhenAll(done, ready)));

        var prices = new Repository<string, decimal>(new Dictionary<string, decimal> { ["bolt"] = 0.25m, ["gear"] = 12.5m, ["belt"] = 7m });
        var validate = new Stage<Order, Order>("validate", async order =>
        {
            await Task.Yield();
            return order.Quantity > 0 ? order : throw new ArgumentException("order " + order.Id + " has no quantity");
        });
        var price = new Stage<Order, Priced>("price", async order => new Priced(order, await prices.GetAsync(order.Sku) * order.Quantity));
        var orders = new[] { new Order(1, "bolt", 40), new Order(2, "gear", 2), new Order(3, "cog", 1), new Order(4, "belt", 0), new Order(5, "belt", 3) };

        Task<Priced>[] work = orders.Select(async order => await price.RunAsync(await validate.RunAsync(order))).ToArray();
        Task<Priced[]> allWork = Task.WhenAll(work);
        try { await allWork; }
        catch (Exception first) { Console.WriteLine("first failure: " + first.GetType().Name + ": " + first.Message + " (of " + allWork.Exception.InnerExceptions.Count + ")"); }
        for (int i = 0; i < work.Length; i++)
        {
            Task<Priced> task = work[i];
            Console.WriteLine("  order " + orders[i].Id + ": " + (task.IsCompletedSuccessfully ? Money(task.Result.Total) : task.Status + " " + task.Exception.InnerException.Message));
        }
        Console.WriteLine(validate.Name + " calls=" + validate.Calls + ", " + price.Name + " calls=" + price.Calls);

        IStage<Order, Priced> viaInterface = price;
        List<Priced> sequential = await viaInterface.RunManyAsync(orders.Where(o => o.Sku != "cog"));
        Console.WriteLine("default member: " + string.Join(" ", sequential.Select(p => p.Order.Id + "=" + Money(p.Total))) + " calls=" + price.Calls);

        decimal[] many = await prices.GetManyAsync("belt", "bolt", "gear");
        Console.WriteLine("GetMany: " + string.Join(" ", many.Select(Money)));
        Task<decimal[]> missing = prices.GetManyAsync("bolt", "nut", "washer");
        Console.WriteLine("GetMany missing: " + await OutcomeAsync(missing) + " inner=" + string.Join("; ", missing.Exception.InnerExceptions.Select(e => e.Message)));

        PriceRule tax = new PriceRule(1.2m), discount = new PriceRule(0.5m);
        decimal figure = await tax.ApplyAsync(100m) + await discount.ApplyAsync(await tax.ApplyAsync(10m)) * (await ready > 40 ? 2 : 3);
        Console.WriteLine("awaits in expression: " + Money(figure));

        Func<int, Task<int>> square = async n => { await Task.Yield(); return n * n; };
        int[] squares = await Task.WhenAll(Enumerable.Range(1, 6).Select(square));
        int nested = await await Task.FromResult(square(await square(3)));
        Console.WriteLine("squares " + string.Join(",", squares) + " sum=" + squares.Sum() + " nested=" + nested);

        decimal grandTotal = 0;
        foreach (Task<Priced> task in work.Where(t => !t.IsFaulted)) grandTotal += (await task).Total;
        Console.WriteLine("grand total " + Money(grandTotal));
        return grandTotal == 56m ? 0 : 1;
    }
}
