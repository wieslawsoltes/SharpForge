using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace StressExceptions;

public sealed class StepFailedException : Exception
{
    public string Step { get; }
    public int Completed { get; }
    public StepFailedException(string step, int completed, Exception inner)
        : base("step '" + step + "' failed after " + completed + " completed", inner) { Step = step; Completed = completed; }
}

public sealed class UnitOfWork
{
    private readonly List<(string Name, Action Do, Action Undo)> steps = new List<(string, Action, Action)>();
    private readonly List<string> journal;
    public UnitOfWork(List<string> journal) { this.journal = journal; }

    public UnitOfWork Add(string name, Action action, Action undo) { steps.Add((name, action, undo)); return this; }

    public int Commit()
    {
        var done = new Stack<(string Name, Action Undo)>();
        try
        {
            foreach (var step in steps)
            {
                try { step.Do(); }
                catch (Exception e) when (e is not StepFailedException) { throw new StepFailedException(step.Name, done.Count, e); }
                done.Push((step.Name, step.Undo));
                journal.Add("did " + step.Name);
            }
            int count = done.Count;
            done.Clear();
            return count;
        }
        catch (StepFailedException failure)
        {
            var errors = new List<Exception> { failure };
            while (done.Count > 0)
            {
                var (name, undo) = done.Pop();
                try { undo(); journal.Add("undid " + name); }
                catch (Exception undoError) { errors.Add(undoError); journal.Add("undo of " + name + " failed"); }
            }
            if (errors.Count > 1) throw new AggregateException("rollback incomplete", errors);
            throw;
        }
        finally
        {
            journal.Add("commit finished with " + steps.Count + " step(s)");
            steps.Clear();
        }
    }
}

public sealed class Shop
{
    public readonly Dictionary<string, int> Stock = new Dictionary<string, int> { ["bolt"] = 10, ["gear"] = 2 };
    public decimal Balance = 50m;
    public readonly List<string> Shipments = new List<string>();

    public void Reserve(string item, int quantity)
    {
        if (Stock[item] < quantity) throw new InvalidOperationException("only " + Stock[item] + " " + item + " left");
        Stock[item] -= quantity;
    }

    public void Charge(decimal amount) => Balance = Balance >= amount ? Balance - amount : throw new ArgumentOutOfRangeException(nameof(amount), amount, "insufficient balance");

    public UnitOfWork PlaceOrder(List<string> journal, string item, int quantity, decimal price, bool brokenRefund = false)
    {
        decimal total = quantity * price;
        return new UnitOfWork(journal)
            .Add("reserve " + item, () => Reserve(item, quantity), () => Stock[item] += quantity)
            .Add("charge", () => Charge(total), () => { if (brokenRefund) throw new NotSupportedException("refund gateway down"); Balance += total; })
            .Add("ship", () => { if (quantity > 5) throw new TimeoutException("carrier busy"); Shipments.Add(quantity + "x" + item); }, () => Shipments.RemoveAt(Shipments.Count - 1));
    }

    public override string ToString() => "stock=" + string.Join(",", Stock.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + ":" + p.Value))
        + " balance=" + Balance.ToString("0.00", CultureInfo.InvariantCulture) + " shipped=[" + string.Join(",", Shipments) + "]";
}

public static class Program
{
    private static readonly List<string> log = new List<string>();
    private static string Drain() { string text = string.Join(" | ", log); log.Clear(); return text; }
    private static string Eval(string value) { log.Add("evaluated " + value); return value; }

    private static int ReturnVsFinally() { int x = 1; try { return x; } finally { x = 99; log.Add("finally sets x=" + x); } }
    private static List<int> ReturnSharedList() { var list = new List<int> { 1 }; try { return list; } finally { list.Add(2); } }
    private static string ReturnOrder() { try { return Eval("result"); } finally { log.Add("finally after evaluation"); } }

    private static int FindFirst(int[][] grid, int target, ref int visited)
    {
        for (int r = 0; r < grid.Length; r++)
        {
            try
            {
                for (int c = 0; c < grid[r].Length; c++)
                {
                    try
                    {
                        if (grid[r][c] < 0) continue;
                        if (grid[r][c] == 0) break;
                        if (grid[r][c] == target) return r * 10 + c;
                    }
                    finally { visited++; }
                }
            }
            finally { log.Add("row" + r); }
        }
        return -1;
    }

    private static int ParseWithFallback(string[] candidates)
    {
        int index = 0;
    retry:
        try { return int.Parse(candidates[index], CultureInfo.InvariantCulture); }
        catch (FormatException) { log.Add("bad:" + candidates[index]); index++; goto retry; }
        catch (IndexOutOfRangeException) { return -1; }
        finally { log.Add("finally#" + index); }
    }

    private static void Run(Shop shop, string label, UnitOfWork work)
    {
        try { Console.WriteLine(label + ": committed " + work.Commit() + " steps"); }
        catch (StepFailedException e) when (e.InnerException is InvalidOperationException or TimeoutException)
        {
            Console.WriteLine(label + ": " + e.Message + " <- " + e.InnerException.GetType().Name + " (" + e.InnerException.Message + ")");
        }
        catch (StepFailedException e) { Console.WriteLine(label + ": " + e.Step + " rejected, inner " + e.InnerException.GetType().Name + ", completed=" + e.Completed); }
        catch (AggregateException e)
        {
            Console.WriteLine(label + ": " + e.InnerExceptions.Count + " errors: " + string.Join(" + ", e.InnerExceptions.Select(x => x.GetType().Name)));
        }
        Console.WriteLine("  journal: " + Drain());
        Console.WriteLine("  " + shop);
    }

    public static void Main()
    {
        var shop = new Shop();
        Run(shop, "ok", shop.PlaceOrder(log, "bolt", 4, 2.5m));
        Run(shop, "no-stock", shop.PlaceOrder(log, "gear", 3, 1m));
        Run(shop, "no-money", shop.PlaceOrder(log, "gear", 2, 30m));
        Run(shop, "carrier", shop.PlaceOrder(log, "bolt", 6, 1.5m));
        Run(shop, "broken-undo", shop.PlaceOrder(log, "bolt", 6, 1m, brokenRefund: true));
        Run(shop, "empty", new UnitOfWork(log));

        Console.WriteLine("return vs finally: " + ReturnVsFinally() + " / " + Drain());
        Console.WriteLine("shared list: " + string.Join(",", ReturnSharedList()));
        Console.WriteLine("order: " + ReturnOrder() + " / " + Drain());

        int[][] grid = { new[] { 5, -1, 0, 7 }, new[] { -1, -1 }, new[] { 3, 7, 9 }, new[] { 7 } };
        int visited = 0;
        Console.WriteLine("find 7 -> " + FindFirst(grid, 7, ref visited) + " visited=" + visited + " / " + Drain());
        visited = 0;
        Console.WriteLine("find 8 -> " + FindFirst(grid, 8, ref visited) + " visited=" + visited + " / " + Drain());

        Console.WriteLine("parse -> " + ParseWithFallback(new[] { "x", "1e3", "42", "7" }) + " / " + Drain());
        Console.WriteLine("parse -> " + ParseWithFallback(new[] { "a", "b" }) + " / " + Drain());

        int total = 0, skipped = 0;
        foreach (string text in new[] { "10", "2147483647", "oops", "5", "stop", "99" })
        {
            try
            {
                if (text == "stop") break;
                total = checked(total + int.Parse(text, CultureInfo.InvariantCulture));
            }
            catch (Exception e) when (e is FormatException || e is OverflowException) { skipped++; continue; }
            finally { log.Add(text + "->" + total); }
            log.Add("accepted");
        }
        Console.WriteLine("total=" + total + " skipped=" + skipped + " / " + Drain());
    }
}
