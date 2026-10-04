using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Telemetry
{
    public interface IDevice { string Id { get; } }
    public sealed record Sensor(string Id, double Volts, float Gain, decimal Cost, int? Errors, long Uptime, double? LastReading) : IDevice;
    public sealed record Gateway(string Id, int Ports) : IDevice;

    public static class Program
    {
        private static string N(IFormattable value) => value == null ? "null" : value.ToString(null, CultureInfo.InvariantCulture);
        private static string N<T>(T? value) where T : struct, IFormattable => value.HasValue ? value.Value.ToString(null, CultureInfo.InvariantCulture) : "null";
        private static string Row(string label, params string[] cells) => label.PadRight(10) + string.Join(" | ", cells);
        private static string Try<T>(Func<T> action)
        {
            try { return Convert.ToString(action(), CultureInfo.InvariantCulture); }
            catch (InvalidOperationException) { return "InvalidOperation"; }
            catch (ArgumentOutOfRangeException) { return "OutOfRange"; }
        }

        public static void Main()
        {
            var sensors = new List<Sensor>
            {
                new Sensor("s1", 3.3, 1.5f, 12.40m, 2, 86_400L, 20.5),
                new Sensor("s2", 5.0, 0.25f, 99.99m, null, 3_000_000_000L, null),
                new Sensor("s3", 1.8, 2.0f, 7.05m, 0, 12L, -3.25),
                new Sensor("s4", 12.0, 0.5f, 0.56m, 7, 604_800L, 101.0),
            };
            var none = new List<Sensor>();

            Console.WriteLine("-- Sum / Average / Min / Max per numeric type");
            Console.WriteLine(Row("double", N(sensors.Sum(s => s.Volts)), N(sensors.Average(s => s.Volts)), N(sensors.Min(s => s.Volts)), N(sensors.Max(s => s.Volts))));
            Console.WriteLine(Row("float", N(sensors.Sum(s => s.Gain)), N(sensors.Average(s => s.Gain)), N(sensors.Min(s => s.Gain)), N(sensors.Max(s => s.Gain))));
            Console.WriteLine(Row("decimal", N(sensors.Sum(s => s.Cost)), N(sensors.Average(s => s.Cost)), N(sensors.Min(s => s.Cost)), N(sensors.Max(s => s.Cost))));
            Console.WriteLine(Row("long", N(sensors.Sum(s => s.Uptime)), N(sensors.Average(s => s.Uptime)), N(sensors.Min(s => s.Uptime)), N(sensors.Max(s => s.Uptime))));
            Console.WriteLine(Row("int?", N(sensors.Sum(s => s.Errors)), N(sensors.Average(s => s.Errors)), N(sensors.Min(s => s.Errors)), N(sensors.Max(s => s.Errors))));
            Console.WriteLine(Row("double?", N(sensors.Sum(s => s.LastReading)), N(sensors.Average(s => s.LastReading)), N(sensors.Min(s => s.LastReading)), N(sensors.Max(s => s.LastReading))));
            Console.WriteLine(Row("int", N(sensors.Sum(s => s.Id.Length)), N(sensors.Average(s => s.Id[1] - '0')), N(sensors.Select(s => (int)s.Volts).Min()), N(sensors.Select(s => (int)s.Volts).Max())));
            Console.WriteLine(Row("empty", N(none.Sum(s => s.Cost)), N(none.Sum(s => s.Errors)), N(none.Average(s => s.Errors)), N(none.Max(s => s.LastReading)), Try(() => none.Average(s => s.Volts)), Try(() => none.Min(s => s.Uptime))));
            Console.WriteLine(Row("generic", sensors.Min(s => s.Id), sensors.Max(s => s.Id), N(sensors.Max(s => (s.Errors ?? -1, s.Id)).Item1), sensors.Select(s => s.Id).Max(Comparer<string>.Create((a, b) => b[1] - a[1]))));
            try { Console.WriteLine(new[] { int.MaxValue, 1 }.Sum()); }
            catch (OverflowException) { Console.WriteLine("int Sum is checked; long sum = " + new[] { int.MaxValue, 1 }.Sum(x => (long)x) + ", decimal avg = " + N(new[] { 1m, 2m, 2m }.Average())); }

            Console.WriteLine("-- MinBy / MaxBy");
            Console.WriteLine(sensors.MinBy(s => s.Cost).Id + " " + sensors.MaxBy(s => s.Uptime).Id + " " + sensors.MaxBy(s => s.Errors).Id + " " + sensors.MinBy(s => s.Errors).Id
                + " " + sensors.MaxBy(s => s.Gain * s.Volts).Id + " " + (none.MaxBy(s => s.Cost) == null) + " " + sensors.MinBy(s => s.Id, Comparer<string>.Create((a, b) => string.CompareOrdinal(b, a))).Id);
            Console.WriteLine(Try(() => new int[0].MinBy(x => x)) + " " + N(new[] { 3.5, -1.25, 9 }.MaxBy(Math.Abs)) + " " + new[] { "pear", "fig", "banana" }.MinBy(w => w.Length));

            Console.WriteLine("-- element operators");
            int[] codes = { 7, 11, 13, 11 };
            Console.WriteLine(string.Join(" ", codes.First(), codes.First(c => c > 7), codes.Last(), codes.Last(c => c < 13), codes.ElementAt(2), codes.ElementAt(^1), codes.Single(c => c == 13)));
            Console.WriteLine(string.Join(" ", codes.FirstOrDefault(c => c > 99), codes.FirstOrDefault(c => c > 99, 991), codes.LastOrDefault(c => c < 0, 992), codes.ElementAtOrDefault(9), codes.ElementAtOrDefault(^9), codes.SingleOrDefault(c => c == 8), codes.SingleOrDefault(c => c == 8, 993)));
            Console.WriteLine(string.Join(" ", Try(() => codes.Single(c => c == 11)), Try(() => codes.SingleOrDefault(c => c == 11)), Try(() => codes.First(c => c > 99)), Try(() => codes.ElementAt(4)), Try(() => none.Last().Id), Try(() => codes.Where(c => c > 99).DefaultIfEmpty(42).Single())));
            Console.WriteLine((sensors.FirstOrDefault(s => s.Volts > 50) == null) + " " + sensors.SingleOrDefault(s => s.Errors == 7)?.Id + " " + (sensors.ElementAtOrDefault(10)?.Id ?? "(none)") + " " + N(sensors.Select(s => s.Errors).FirstOrDefault(e => e > 100)) + " " + N(sensors.Select(s => s.LastReading).LastOrDefault()));

            Console.WriteLine("-- generators, Cast, OfType");
            Console.WriteLine(string.Join(",", Enumerable.Range(-2, 5).Select(x => N(x))) + " " + string.Join("", Enumerable.Repeat("ab", 3)) + " " + Enumerable.Empty<Sensor>().Count() + " " + Enumerable.Range(1, 100).Sum() + " " + Enumerable.Repeat(0.1, 10).Sum().ToString("R", CultureInfo.InvariantCulture) + " " + N(Enumerable.Repeat(0.1m, 10).Sum()));
            var mixed = new ArrayList { 1, "two", 3.0, null, 4, 'c', 5L, new Gateway("g1", 8), sensors[0] };
            Console.WriteLine(string.Join(",", mixed.OfType<int>()) + " " + string.Join(",", mixed.OfType<string>()) + " " + mixed.OfType<object>().Count() + " " + mixed.OfType<IDevice>().Select(d => d.Id).Aggregate((a, b) => a + "+" + b) + " " + mixed.OfType<IFormattable>().Count());
            IEnumerable<IDevice> devices = sensors.Cast<IDevice>().Append(new Gateway("g2", 4)).Prepend(new Gateway("g0", 16));
            Console.WriteLine(string.Join(" ", devices.Select(d => d.Id)) + " ports=" + devices.OfType<Gateway>().Sum(g => g.Ports) + " " + mixed.Cast<object>().Count(o => o is ValueType) + " " + string.Join("", new ArrayList { 1, 2, 3 }.Cast<int>().Select(x => x * x)));
            try { Console.WriteLine(mixed.Cast<int>().Sum()); }
            catch (InvalidCastException) { Console.WriteLine("Cast<int> fails on the first non-int, lazily"); }

            Console.WriteLine("-- Append / Prepend / Concat / Reverse / Skip / Take");
            IEnumerable<int> line = Enumerable.Range(1, 3).Append(4).Prepend(0).Concat(new[] { 9, 9 }).Concat(Enumerable.Empty<int>());
            Console.WriteLine(string.Join("", line) + " " + string.Join("", line.Reverse()) + " " + string.Join("", line.Skip(2).Take(3)) + " " + string.Join("", line.SkipLast(2).TakeLast(2)) + " " + string.Join("", line.Take(2..^2)) + " " + string.Join("", line.Take(^3..)) + " " + string.Join("", line.SkipWhile(x => x < 3).TakeWhile((x, i) => i < 2 || x == 9)));
            Console.WriteLine(string.Join(" ", line.Chunk(3).Select(chunk => string.Join("", chunk) + "/" + chunk.Length)) + " " + string.Join("", line.Index().Where(p => p.Index % 2 == 0).Select(p => p.Item)) + " " + line.TryGetNonEnumeratedCount(out int quick) + quick + " " + codes.TryGetNonEnumeratedCount(out quick) + quick);

            Console.WriteLine("-- quantifiers and counting");
            Console.WriteLine(string.Join(" ", sensors.Any(), none.Any(), sensors.Any(s => s.Errors == null), sensors.All(s => s.Cost > 0.5m), none.All(s => s.Volts > 1e9), sensors.Count(s => s.Errors > 0), sensors.LongCount(s => s.Uptime > int.MaxValue),
                codes.Contains(13), sensors.Select(s => s.Errors).Contains(null), sensors.Select(s => s.Gain).Contains(0.25f), codes.Count(c => c == 11), codes.Distinct().Count(), sensors.Count(s => s.LastReading is > 0 and < 100)));
        }
    }
}
