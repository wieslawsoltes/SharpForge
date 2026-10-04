using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;

public class DomainException : Exception
{
    public string Code { get; }
    public DomainException(string code, string message, Exception inner = null) : base(message, inner) { Code = code; }
    public override string Message => "[" + Code + "] " + base.Message;
}

public class ValidationException : DomainException
{
    public string Field { get; }
    public ValidationException(string field, string message, Exception inner = null) : base("VAL", field + " " + message, inner) { Field = field; }
}

public sealed class RangeViolationException : ValidationException
{
    public decimal Actual { get; }
    public RangeViolationException(string field, decimal actual, decimal min, decimal max)
        : base(field, string.Create(CultureInfo.InvariantCulture, $"{actual} is outside {min}..{max}")) { Actual = actual; }
}

public sealed record Order(string Id, string Customer, int Quantity, decimal UnitPrice, string Coupon);

public sealed class Validator
{
    private readonly List<(string Name, Action<Order> Rule)> rules = new List<(string, Action<Order>)>();
    public Validator Rule(string name, Action<Order> rule) { rules.Add((name, rule)); return this; }

    public void Validate(Order order)
    {
        var errors = new List<Exception>();
        foreach (var (name, rule) in rules)
        {
            try { rule(order); }
            catch (ValidationException e)
            {
                e.Data["rule"] = name;
                e.Data["order"] = order.Id;
                errors.Add(e);
            }
            catch (Exception e) when (e is not DomainException) { errors.Add(new DomainException("BUG", "rule '" + name + "' crashed on " + order.Id, e)); }
        }
        if (errors.Count == 1) throw errors[0];
        if (errors.Count > 1) throw new AggregateException("order " + order.Id + " is invalid", errors);
    }
}

public static class Program
{
    private static string Describe(Exception e) => e switch
    {
        RangeViolationException r => "range(" + r.Field + "=" + r.Actual.ToString(CultureInfo.InvariantCulture) + ")",
        ValidationException v => "validation(" + v.Field + ")",
        DomainException d when d.InnerException != null => d.Code + "<-" + d.InnerException.GetType().Name,
        DomainException d => d.Code,
        AggregateException a => "aggregate[" + string.Join(", ", a.InnerExceptions.Select(Describe)) + "]",
        _ => e.GetType().Name,
    };

    private static IEnumerable<decimal> Totals(IEnumerable<Order> orders)
    {
        foreach (Order order in orders)
        {
            if (order.Quantity <= 0) throw new RangeViolationException("Quantity", order.Quantity, 1, 100);
            yield return order.Quantity * order.UnitPrice;
        }
    }

    private static async Task<decimal> PriceAsync(Order order)
    {
        if (order.Customer == null) throw new ValidationException("Customer", "is required (thrown before the first await)");
        await Task.Yield();
        if (order.UnitPrice <= 0) throw new RangeViolationException("UnitPrice", order.UnitPrice, 0.01m, 1000m);
        return order.Quantity * order.UnitPrice;
    }

    public static async Task Main()
    {
        var validator = new Validator()
            .Rule("customer", o => { if (string.IsNullOrWhiteSpace(o.Customer)) throw new ValidationException("Customer", "is required"); })
            .Rule("quantity", o => { if (o.Quantity is < 1 or > 100) throw new RangeViolationException("Quantity", o.Quantity, 1, 100); })
            .Rule("price", o => { if (o.UnitPrice <= 0) throw new RangeViolationException("UnitPrice", o.UnitPrice, 0.01m, 1000m); })
            .Rule("coupon", o => { if (int.Parse(o.Coupon.Split('-')[1], CultureInfo.InvariantCulture) > 50) throw new ValidationException("Coupon", "discount too large"); });

        var orders = new[]
        {
            new Order("A1", "Ada", 3, 9.99m, "SAVE-10"),
            new Order("B2", "", 0, 5m, "SAVE-90"),
            new Order("C3", "Cy", 500, 1.5m, "SAVE-5"),
            new Order("D4", "Di", 2, -1m, null),
            new Order("E5", null, 1, 2.25m, "SAVE"),
            new Order("F6", "Flo", 4, 2.5m, "SAVE-x"),
        };

        var failures = new List<Exception>();
        foreach (Order order in orders)
        {
            try { validator.Validate(order); Console.WriteLine(order.Id + " valid"); }
            catch (RangeViolationException e) { failures.Add(e); Console.WriteLine(order.Id + " single " + Describe(e) + " rule=" + e.Data["rule"] + " msg=" + e.Message); }
            catch (ValidationException e) { failures.Add(e); Console.WriteLine(order.Id + " single " + Describe(e)); }
            catch (DomainException e) { failures.Add(e); Console.WriteLine(order.Id + " domain " + Describe(e) + " msg=" + e.Message); }
            catch (AggregateException e) { failures.Add(e); Console.WriteLine(order.Id + " " + Describe(e)); }
        }

        var batch = new AggregateException("batch failed", failures);
        AggregateException flat = batch.Flatten();
        Console.WriteLine("nested=" + batch.InnerExceptions.Count + " flat=" + flat.InnerExceptions.Count + " data keys on first=" + flat.InnerExceptions[0].Data.Count);
        var byField = flat.InnerExceptions.OfType<ValidationException>().GroupBy(v => v.Field, StringComparer.Ordinal).OrderBy(g => g.Key, StringComparer.Ordinal);
        Console.WriteLine(string.Join("; ", byField.Select(g => g.Key + "=" + string.Join("/", g.Select(v => (string)v.Data["order"])))));

        int handled = 0;
        try { flat.Handle(e => { if (e is ValidationException) { handled++; return true; } return false; }); }
        catch (AggregateException rest) { Console.WriteLine("handled=" + handled + " unhandled=" + Describe(rest)); }
        flat.Handle(e => e is DomainException);
        Console.WriteLine("all domain errors handled, base of batch: " + Describe(batch.GetBaseException()));

        IEnumerable<decimal> lazy = Totals(orders);
        var partial = new List<decimal>();
        try { foreach (decimal total in lazy) partial.Add(total); }
        catch (RangeViolationException e) { Console.WriteLine("iterator threw after " + partial.Count + " item(s): " + Describe(e) + ", sum=" + partial.Sum().ToString(CultureInfo.InvariantCulture)); }

        IEnumerable<int> shares = orders.Select(o => o.Quantity > 0 ? 600 / o.Quantity : throw new DomainException("DIV", "no quantity for " + o.Id));
        Console.WriteLine("lazy lambda ok: " + shares.First());
        try { Console.WriteLine(shares.Sum()); }
        catch (DomainException e) { Console.WriteLine("lambda threw on enumeration: " + e.Message); }

        Task<decimal> eager = PriceAsync(orders[4]);
        Console.WriteLine("sync throw captured: " + eager.Status + " " + Describe(eager.Exception.InnerException));
        Task<decimal>[] tasks = orders.Select(PriceAsync).ToArray();
        Task<decimal[]> all = Task.WhenAll(tasks);
        try { await all; }
        catch (ValidationException e) { Console.WriteLine("await rethrows first only: " + Describe(e)); }
        Console.WriteLine(all.Status + " with " + all.Exception.InnerExceptions.Count + ": " + Describe(all.Exception));
        Console.WriteLine(string.Join(" ", tasks.Select(t => t.IsFaulted ? "F" : t.Result.ToString(CultureInfo.InvariantCulture))));

        Task<int> failed = Task.FromException<int>(new DomainException("IO", "disk offline", new TimeoutException()));
        try { failed.Wait(); }
        catch (AggregateException e) { Console.WriteLine("Wait wraps: " + Describe(e)); }
        try { Console.WriteLine(failed.GetAwaiter().GetResult()); }
        catch (DomainException e) { Console.WriteLine("GetResult unwraps: " + Describe(e) + " same=" + ReferenceEquals(e, failed.Exception.InnerException)); }

        Func<Order, Task<string>> safe = async order =>
        {
            try { return (await PriceAsync(order)).ToString("0.00", CultureInfo.InvariantCulture); }
            catch (RangeViolationException e) when (e.Actual < 0) { return "negative"; }
            catch (ValidationException e) { return "invalid:" + e.Field; }
            finally { await Task.Yield(); }
        };
        var summary = new List<string>();
        foreach (Order order in orders) summary.Add(order.Id + "=" + await safe(order));
        Console.WriteLine(string.Join(" ", summary));
    }
}
