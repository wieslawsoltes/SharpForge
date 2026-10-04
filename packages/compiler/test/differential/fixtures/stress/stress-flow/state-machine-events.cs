using System;
using System.Collections.Generic;
using System.Text;

public enum OrderState { Created, Paid, Packed, Shipped, Delivered, Cancelled, Refunded }

[Flags]
public enum OrderFlags : byte { None = 0, Gift = 1, Express = 2, Fragile = 4, All = Gift | Express | Fragile }

public enum Trigger { Pay, Pack, Ship, Deliver, Cancel, Refund }

public sealed class TransitionEventArgs : EventArgs
{
    public TransitionEventArgs(OrderState from, OrderState to, Trigger trigger) { From = from; To = to; Trigger = trigger; }
    public OrderState From { get; }
    public OrderState To { get; }
    public Trigger Trigger { get; }
    public bool Veto { get; set; }
}

public sealed class Order
{
    private readonly List<string> log = new List<string>();
    public event EventHandler<TransitionEventArgs> Transitioning;
    public event Action<Order, OrderState> Transitioned;

    public Order(int number, OrderFlags flags) { Number = number; Flags = flags; }
    public int Number { get; }
    public OrderFlags Flags { get; private set; }
    public OrderState State { get; private set; } = OrderState.Created;
    public IReadOnlyList<string> Log => log;

    public static OrderState? Next(OrderState state, Trigger trigger) => (state, trigger) switch
    {
        (OrderState.Created, Trigger.Pay) => OrderState.Paid,
        (OrderState.Paid, Trigger.Pack) => OrderState.Packed,
        (OrderState.Packed, Trigger.Ship) => OrderState.Shipped,
        (OrderState.Shipped, Trigger.Deliver) => OrderState.Delivered,
        (OrderState.Created or OrderState.Paid or OrderState.Packed, Trigger.Cancel) => OrderState.Cancelled,
        (OrderState.Delivered or OrderState.Cancelled, Trigger.Refund) => OrderState.Refunded,
        _ => null,
    };

    public bool Fire(Trigger trigger)
    {
        OrderState? target = Next(State, trigger);
        if (target is not { } next)
        {
            log.Add($"{State}: {trigger} ignored");
            return false;
        }
        var args = new TransitionEventArgs(State, next, trigger);
        Transitioning?.Invoke(this, args);
        if (args.Veto)
        {
            log.Add($"{State}: {trigger} vetoed");
            return false;
        }
        var previous = State;
        State = next;
        log.Add($"{previous} -{trigger}-> {next}");
        Transitioned?.Invoke(this, previous);
        return true;
    }

    public void Toggle(OrderFlags flag) => Flags ^= flag;
}

public static class Program
{
    private static int transitions;

    private static string Describe(OrderFlags flags)
    {
        var builder = new StringBuilder();
        foreach (OrderFlags flag in new[] { OrderFlags.Gift, OrderFlags.Express, OrderFlags.Fragile })
        {
            if ((flags & flag) != 0) builder.Append(builder.Length > 0 ? "+" : "").Append(flag);
        }
        return builder.Length == 0 ? "plain" : builder.ToString();
    }

    private static int Cost(Order order) => order.State switch
    {
        OrderState.Created => 0,
        OrderState.Paid or OrderState.Packed => order.Flags.HasFlag(OrderFlags.Express) ? 15 : 5,
        OrderState.Shipped when (order.Flags & OrderFlags.Fragile) != 0 => 40,
        OrderState.Shipped => 20,
        >= OrderState.Delivered and < OrderState.Refunded => 25,
        _ => -1,
    };

    public static void Main()
    {
        var order = new Order(17, OrderFlags.Gift | OrderFlags.Fragile);
        EventHandler<TransitionEventArgs> audit = (sender, e) => Console.WriteLine($"  audit #{((Order)sender).Number}: {e.From}->{e.To} by {e.Trigger}");
        EventHandler<TransitionEventArgs> noShippingOnFragileGift = (sender, e) =>
        {
            if (e.Trigger == Trigger.Ship && sender is Order { Flags: OrderFlags.Gift | OrderFlags.Fragile }) e.Veto = true;
        };
        order.Transitioning += audit;
        order.Transitioning += noShippingOnFragileGift;
        order.Transitioned += (o, from) => transitions++;
        order.Transitioned += (o, from) => Console.WriteLine($"  now {o.State} (was {from}), cost {Cost(o)}");

        Trigger[] script = { Trigger.Pack, Trigger.Pay, Trigger.Pack, Trigger.Ship, Trigger.Ship, Trigger.Deliver, Trigger.Cancel, Trigger.Refund, Trigger.Refund };
        int step = 0;
        foreach (var trigger in script)
        {
            if (step == 4) order.Toggle(OrderFlags.Gift);
            if (step == 6) order.Transitioning -= audit;
            Console.WriteLine($"{step++}: {trigger} -> {order.Fire(trigger)} [{Describe(order.Flags)}]");
        }
        Console.WriteLine("transitions: " + transitions);
        foreach (var line in order.Log) Console.WriteLine(line);

        Console.WriteLine(OrderFlags.All + " " + (OrderFlags)3 + " " + (OrderFlags)8 + " " + (int)OrderFlags.All + " " + default(OrderFlags));
        Console.WriteLine(Enum.Parse<OrderState>("Shipped") + " " + (OrderState)42 + " " + Enum.IsDefined(typeof(OrderState), 6));
        Console.WriteLine(string.Join(",", Enum.GetNames(typeof(Trigger))));
        Console.WriteLine(Enum.TryParse("packed", true, out OrderState parsed) + " " + parsed + " " + OrderState.Paid.CompareTo(OrderState.Packed));
        var counts = new Dictionary<OrderState, int>();
        foreach (OrderState state in Enum.GetValues(typeof(OrderState)))
        {
            int reachable = 0;
            foreach (Trigger t in Enum.GetValues(typeof(Trigger))) if (Order.Next(state, t).HasValue) reachable++;
            counts[state] = reachable;
        }
        foreach (var pair in counts) Console.Write($"{pair.Key}:{pair.Value} ");
        Console.WriteLine();
        Console.WriteLine($"{OrderState.Paid:D} {OrderState.Paid:G} {OrderFlags.All:X} {OrderFlags.Express | OrderFlags.Gift:F}");
    }
}
