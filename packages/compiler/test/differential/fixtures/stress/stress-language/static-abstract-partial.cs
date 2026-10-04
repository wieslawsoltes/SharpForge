using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;

namespace Metering;

public interface IQuantity<TSelf> where TSelf : IQuantity<TSelf>
{
    long Raw { get; }
    static abstract string Unit { get; }
    static abstract TSelf Parse(string text);
    static abstract TSelf operator +(TSelf left, TSelf right);
    static abstract TSelf operator checked +(TSelf left, TSelf right);
    static virtual TSelf Zero => TSelf.Parse("0");
    static virtual string Format(TSelf value) => value.Raw.ToString(CultureInfo.InvariantCulture) + TSelf.Unit;
}

public readonly struct Meters(long raw) : IQuantity<Meters>
{
    public long Raw => raw;
    public static string Unit => "m";
    public static Meters Parse(string text) => new(long.Parse(text, CultureInfo.InvariantCulture));
    public static Meters operator +(Meters left, Meters right) => new(unchecked(left.Raw + right.Raw));
    public static Meters operator checked +(Meters left, Meters right) => new(checked(left.Raw + right.Raw));
    public static Meters operator -(Meters value) => new(unchecked(-value.Raw));
    public static Meters operator checked -(Meters value) => new(checked(-value.Raw));
    public static explicit operator int(Meters value) => unchecked((int)value.Raw);
    public static explicit operator checked int(Meters value) => checked((int)value.Raw);
}

public readonly struct Celsius(int tenths) : IQuantity<Celsius>
{
    public long Raw => tenths;
    public static string Unit => "C";
    public static Celsius Zero => new(-2731);
    public static Celsius Parse(string text) => new((int)Math.Round(double.Parse(text, CultureInfo.InvariantCulture) * 10));
    public static Celsius operator +(Celsius left, Celsius right) => new(unchecked((int)(left.Raw + right.Raw)));
    public static Celsius operator checked +(Celsius left, Celsius right) => new(checked((int)(left.Raw + right.Raw)));
    public static string Format(Celsius value) => (value.Raw / 10.0).ToString("0.0", CultureInfo.InvariantCulture) + " deg" + Unit;
}

public static class Quantities
{
    public static T Sum<T>(params string[] texts) where T : IQuantity<T>
    {
        T total = T.Zero;
        foreach (var text in texts) total += T.Parse(text);
        return total;
    }

    public static string TrySumChecked<T>(T start, params T[] values) where T : IQuantity<T>
    {
        try
        {
            foreach (var value in values) start = checked(start + value);
            return T.Format(start);
        }
        catch (OverflowException) { return "overflow[" + T.Unit + "]"; }
    }

    public static string Report<T>(T value) where T : IQuantity<T> => T.Format(value) + "/" + typeof(T).Name + "/" + T.Format(T.Zero);
    public static long Dot(ref readonly Reading a, ref readonly Reading b) => (long)a.Value * b.Value + (long)a.Weight * b.Weight;
}

public struct Reading
{
    public int Value, Weight;
}

public partial class Sensor
{
    public partial Sensor(string name, int capacity);
    public partial string Name { get; set; }
    public partial int this[int index] { get; }
    public partial event Action<string, int> Changed;
    public partial bool TryRecord(int value, out int count);
    partial void OnRecorded(int value);
    public long Total { get; private set; }
}

public partial class Sensor
{
    private readonly Lock _gate = new();
    private readonly List<int> _readings;
    private readonly int _capacity;
    private Action<string, int> _changed;

    public partial Sensor(string name, int capacity)
    {
        Name = name;
        _capacity = capacity;
        _readings = new List<int>(capacity);
    }

    public partial string Name { get; set => field = string.IsNullOrWhiteSpace(value) ? "unnamed" : value.Trim(); }
    public partial int this[int index] { get { lock (_gate) { return _readings[index < 0 ? _readings.Count + index : index]; } } }

    public partial event Action<string, int> Changed
    {
        add { lock (_gate) { _changed += value; } }
        remove { lock (_gate) { _changed -= value; } }
    }

    public partial bool TryRecord(int value, out int count)
    {
        using (_gate.EnterScope())
        {
            count = _readings.Count;
            if (count == _capacity) return false;
            _readings.Add(value);
            count++;
            OnRecorded(value);
        }
        _changed?.Invoke(Name, value);
        return true;
    }

    partial void OnRecorded(int value) => Total += value;
    public bool Busy => _gate.IsHeldByCurrentThread;

    public string Snapshot()
    {
        if (!_gate.TryEnter()) return "locked";
        try { return Name + "[" + string.Join(",", _readings) + "] busy=" + Busy; }
        finally { _gate.Exit(); }
    }
}

file sealed record Alarm(string Sensor, int Value)
{
    public string Severity => Value switch { >= 90 => "critical", >= 50 => "warning", _ => "info" };
}

file static class Thresholds
{
    public static readonly int[] Levels = [50, 90];
    public static IEnumerable<Alarm> Above(this IEnumerable<Alarm> alarms, int level) => alarms.Where(a => a.Value >= Levels[level]);
}

public static class Program
{
    public static void Main()
    {
        Console.WriteLine(Quantities.Report(Quantities.Sum<Meters>("120", "30", "-8")) + " " + Quantities.Report(Quantities.Sum<Celsius>("293.6", "0.5", "1")) + " " + Quantities.Report(default(Celsius)));
        var huge = new Meters(long.MaxValue - 5);
        var sum = huge + new Meters(10);
        Console.WriteLine($"{sum.Raw == long.MinValue + 4} {Quantities.TrySumChecked(huge, new Meters(3), new Meters(2))} {Quantities.TrySumChecked(huge, new Meters(3), new Meters(3))} {Quantities.TrySumChecked(new Celsius(int.MaxValue), new Celsius(1))} {Quantities.TrySumChecked(new Celsius(15), new Celsius(200))}");
        var far = new Meters(5_000_000_000);
        var lowest = new Meters(long.MinValue);
        string narrowed, negated;
        try { narrowed = checked((int)far).ToString(); } catch (OverflowException) { narrowed = "overflow"; }
        try { negated = checked(-lowest).Raw.ToString(); } catch (OverflowException) { negated = "overflow"; }
        Console.WriteLine($"{(int)far} {narrowed} {(-lowest).Raw == long.MinValue} {negated} {checked((int)new Meters(77))} {checked(-new Meters(77)).Raw} {checked(far + far).Raw} {unchecked(huge + huge).Raw}");

        var events = new List<Alarm>();
        var sensor = new Sensor("  boiler ", 4);
        Action<string, int> listener = (name, value) => events.Add(new Alarm(name, value));
        Action<string, int> counter = (_, value) => events.Add(new Alarm("echo", -value));
        sensor.Changed += listener;
        sensor.Changed += counter;
        foreach (int value in new[] { 40, 95, 60 }) Console.WriteLine($"record {value}: {sensor.TryRecord(value, out int count)} count={count} total={sensor.Total}");
        Console.WriteLine(sensor.Snapshot() + " events=" + events.Count + " last=" + events[^1].Value);
        sensor.Changed -= counter;
        sensor.Name = "\tboiler-2";
        bool fourth = sensor.TryRecord(10, out int afterFourth), fifth = sensor.TryRecord(99, out int afterFifth);
        sensor.Name = " ";
        Console.WriteLine($"{fourth}/{afterFourth} {fifth}/{afterFifth} {sensor[0]} {sensor[-1]} {sensor.Total} {sensor.Snapshot()} {sensor.Busy} {events.Count}");
        foreach (var alarm in events.Where(a => a.Value > 0).OrderByDescending(a => a.Value)) Console.WriteLine($"  {alarm} {alarm.Severity}");
        Console.WriteLine(string.Join(" ", events.Above(0).Select(a => a.Value)) + " | " + string.Join(" ", events.Above(1).Select(a => a.Sensor)) + " | " + events.Count(a => a == new Alarm("echo", -95))
            + " " + (events[0] with { Value = 95 } == events[2]) + " " + events.Min(a => a.Value));

        var gate = new Lock();
        int depth = 0;
        lock (gate)
        {
            lock (gate) { depth += gate.IsHeldByCurrentThread ? 2 : 0; }
            using (gate.EnterScope()) depth += 10;
            depth += gate.IsHeldByCurrentThread ? 100 : 0;
        }
        var worker = new Thread(() => { if (gate.TryEnter()) { depth += 1000; gate.Exit(); } });
        worker.Start();
        worker.Join();
        Console.WriteLine($"{depth} {gate.IsHeldByCurrentThread}");

        Reading a = new() { Value = 3, Weight = 4 }, b = new() { Value = -2, Weight = 10 };
        ref readonly Reading alias = ref a;
        Console.WriteLine($"{Quantities.Dot(ref a, ref b)} {Quantities.Dot(in a, in a)} {Quantities.Dot(in alias, ref b)} {Meters.Unit}{Celsius.Unit} {Celsius.Zero.Raw} {nameof(IQuantity<Meters>.Zero)}");
    }
}
