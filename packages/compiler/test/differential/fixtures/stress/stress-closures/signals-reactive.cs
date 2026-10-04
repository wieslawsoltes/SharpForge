using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public interface ISource { event Action Invalidated; }

public sealed class Signal<T> : ISource
{
    private T value;
    public event Action Invalidated;
    public Signal(T initial) { value = initial; }
    public int Subscribers => Invalidated?.GetInvocationList().Length ?? 0;

    public T Value
    {
        get => value;
        set
        {
            if (EqualityComparer<T>.Default.Equals(this.value, value)) return;
            this.value = value;
            Invalidated?.Invoke();
        }
    }

    public Func<T> Getter => () => value;
    public Action<T> Setter => next => Value = next;
}

public sealed class Computed<T> : ISource
{
    private readonly Func<T> compute;
    private T cached;
    private bool dirty = true;
    public int Recomputations { get; private set; }
    public event Action Invalidated;

    public Computed(Func<T> compute, params ISource[] dependencies)
    {
        this.compute = compute;
        foreach (ISource dependency in dependencies)
            dependency.Invalidated += () => { if (dirty) return; dirty = true; Invalidated?.Invoke(); };
    }

    public T Value
    {
        get
        {
            if (dirty) { cached = compute(); dirty = false; Recomputations++; }
            return cached;
        }
    }
}

public sealed class History<T>(int capacity)
{
    private readonly Queue<T> items = new Queue<T>();
    public Action<T> Recorder => item => { if (items.Count == capacity) items.Dequeue(); items.Enqueue(item); };
    public override string ToString() => string.Join(">", items);
}

public struct Point
{
    public int X, Y;
    public void Offset(int dx, int dy) { X += dx; Y += dy; }
}

public static class Reactive
{
    public static Action Effect(Action run, params ISource[] dependencies)
    {
        Action handler = () => run();
        foreach (ISource dependency in dependencies) dependency.Invalidated += handler;
        run();
        return () => { foreach (ISource dependency in dependencies) dependency.Invalidated -= handler; };
    }

    public static void Once(ISource source, Action action)
    {
        Action handler = null;
        handler = () => { source.Invalidated -= handler; action(); };
        source.Invalidated += handler;
    }

    public static (Action Increment, Func<int> Read, Action Reset) Counter(int start, int step = 1)
    {
        int count = start;
        return (() => count += step, () => count, () => count = start);
    }
}

public static class Program
{
    private static string Money(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);

    public static void Main()
    {
        var log = new List<string>();
        string Drain() { string text = string.Join(" ", log); log.Clear(); return text; }

        var price = new Signal<decimal>(10m);
        var quantity = new Signal<int>(2);
        var rate = new Signal<decimal>(0.2m);
        var subtotal = new Computed<decimal>(() => price.Value * quantity.Value, price, quantity);
        var tax = new Computed<decimal>(() => subtotal.Value * rate.Value, subtotal, rate);
        var total = new Computed<decimal>(() => subtotal.Value + tax.Value, subtotal, tax);
        var history = new History<string>(3);
        Action<string> record = history.Recorder;
        int effectRuns = 0;
        Action stop = Reactive.Effect(() => { effectRuns++; string text = Money(total.Value); log.Add("total=" + text); record(text); }, total);
        Reactive.Once(quantity, () => log.Add("quantity-first-change"));

        price.Value = 12m;
        Console.WriteLine("initial + price change: " + Drain());
        quantity.Value = 3;
        quantity.Value = 3;
        Console.WriteLine("quantity change: " + Drain() + " | quantity subscribers=" + quantity.Subscribers);
        rate.Value = 0.1m;
        quantity.Setter(5);
        Console.WriteLine(Drain());
        Console.WriteLine("effect runs=" + effectRuns + " recomputed subtotal/tax/total=" + subtotal.Recomputations + "/" + tax.Recomputations + "/" + total.Recomputations + " history=" + history);
        stop();
        price.Value = 100m;
        Console.WriteLine("after stop: log=[" + Drain() + "] runs=" + effectRuns + " lazy total=" + Money(total.Value) + " recomputed=" + total.Recomputations + " getter=" + Money(price.Getter()));

        Signal<int>[] cells = Enumerable.Range(0, 3).Select(i => new Signal<int>(i)).ToArray();
        var unsubscribers = new List<Action>();
        for (int i = 0; i < cells.Length; i++)
        {
            int index = i;
            Action shared = () => log.Add("for-shared:" + i);
            Action own = () => log.Add("for-copy:" + index);
            cells[i].Invalidated += shared;
            cells[i].Invalidated += own;
            unsubscribers.Add(() => { cells[index].Invalidated -= shared; cells[index].Invalidated -= own; });
        }
        cells[1].Value = 10;
        Console.WriteLine(Drain());
        foreach (Signal<int> cell in cells) cell.Invalidated += () => log.Add("foreach:" + cell.Value);
        int n = 0;
        while (n < cells.Length)
        {
            int snapshot = n * 100;
            Signal<int> cell = cells[n];
            cell.Invalidated += () => log.Add("while:" + snapshot + "/" + n);
            n++;
        }
        cells[2].Value = 20;
        Console.WriteLine(Drain() + " | subscribers=" + string.Join(",", cells.Select(c => c.Subscribers)));
        unsubscribers[2]();
        unsubscribers[2]();
        n = 99;
        cells[2].Value = 21;
        cells[0].Value = 5;
        Console.WriteLine(Drain() + " | subscribers=" + string.Join(",", cells.Select(c => c.Subscribers)));

        var sum = new Computed<int>(() => cells.Sum(c => c.Value), cells);
        var parity = new Computed<string>(() => sum.Value % 2 == 0 ? "even" : "odd", sum);
        var seen = new List<string>();
        Action stopParity = Reactive.Effect(() => seen.Add(sum.Value + ":" + parity.Value), parity);
        foreach (int delta in new[] { 1, 1, 2, -4 }) cells[delta > 0 ? 0 : 1].Value += delta;
        log.Clear();
        Console.WriteLine("sum/parity: " + string.Join(" ", seen) + " | recomputed " + sum.Recomputations + "/" + parity.Recomputations);
        stopParity();

        var (increment, read, reset) = Reactive.Counter(10, step: 5);
        increment(); increment();
        int beforeReset = read();
        reset(); increment();
        var other = Reactive.Counter(0);
        other.Increment();
        Console.WriteLine("counter: " + beforeReset + " -> " + read() + ", independent counter: " + other.Read());

        var point = new Point { X = 1, Y = 1 };
        Action move = () => point.Offset(5, -1);
        Point copy = point;
        Func<int> readCopy = () => copy.X * 10 + copy.Y;
        move(); move();
        copy.Y = 7;
        Console.WriteLine("captured struct: point=" + point.X + "," + point.Y + " copy via lambda=" + readCopy());

        Func<int, Func<int, Func<int, int>>> nest = a =>
        {
            int calls = 0;
            return b => { calls++; return c => a * 100 + b * 10 + c + calls * 1000; };
        };
        var level2 = nest(1);
        var first = level2(2);
        var second = level2(3);
        Console.WriteLine("nested scopes: " + first(4) + " " + second(4) + " " + first(5) + " " + nest(9)(9)(9));

        var handlers = new Dictionary<string, Action<int>>();
        int accumulated = 0;
        foreach (var (name, factor) in new[] { ("double", 2), ("triple", 3), ("negate", -1) }) handlers[name] = amount => accumulated += amount * factor;
        foreach (string name in new[] { "double", "negate", "triple", "double" }) handlers[name](10);
        Console.WriteLine("dictionary of closures: accumulated=" + accumulated);

        var once = new Signal<string>("a");
        int fired = 0;
        Reactive.Once(once, () => fired++);
        Reactive.Once(once, () => fired += 10);
        once.Value = "b"; once.Value = "c";
        Console.WriteLine("once handlers fired total=" + fired + " remaining subscribers=" + once.Subscribers);
    }
}
