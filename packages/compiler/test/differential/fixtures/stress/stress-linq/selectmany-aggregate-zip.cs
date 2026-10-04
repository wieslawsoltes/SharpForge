using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Timetable
{
    public sealed class Course
    {
        public Course(string code, params string[] topics) { Code = code; Topics = topics; }
        public string Code { get; }
        public IReadOnlyList<string> Topics { get; }
    }

    public readonly struct Slot
    {
        public Slot(int day, int hour) { Day = day; Hour = hour; }
        public int Day { get; }
        public int Hour { get; }
        public override string ToString() => "MTWRF"[Day] + Hour.ToString("D2", CultureInfo.InvariantCulture);
    }

    public static class Stats
    {
        // Aggregate without a seed: the first element is the seed, so an empty source throws.
        public static T Fold<T>(this IEnumerable<T> source, Func<T, T, T> combine) => source.Aggregate(combine);

        public static (double Mean, double Deviation) MeanAndDeviation(this IEnumerable<int> source) =>
            source.Aggregate(
                (Count: 0, Sum: 0.0, Squares: 0.0),
                (acc, x) => (acc.Count + 1, acc.Sum + x, acc.Squares + (double)x * x),
                acc => (acc.Sum / acc.Count, Math.Sqrt(acc.Squares / acc.Count - acc.Sum / acc.Count * (acc.Sum / acc.Count))));
    }

    public static class Program
    {
        private static string F(double value) => value.ToString("F3", CultureInfo.InvariantCulture);

        public static void Main()
        {
            var courses = new List<Course>
            {
                new Course("ALG", "sorting", "graphs", "dp"),
                new Course("OS", "processes", "memory"),
                new Course("EMPTY"),
                new Course("DB", "sql", "indexes", "transactions", "recovery"),
            };
            int[] attendance = { 31, 28, 0, 17 };
            string[] rooms = { "A1", "B2", "C3" };

            Console.WriteLine("-- SelectMany overloads");
            Console.WriteLine(string.Join(" ", courses.SelectMany(c => c.Topics)));
            Console.WriteLine(string.Join(" ", courses.SelectMany((c, i) => c.Topics.Select(t => i + "." + t[0]))));
            Console.WriteLine(string.Join(" ", courses.SelectMany(c => c.Topics, (c, topic) => c.Code + ":" + topic.Length)));
            Console.WriteLine(string.Join(" ", courses.SelectMany((c, i) => c.Topics.Take(i + 1), (c, topic) => new { c.Code, topic }).Select(x => x.Code[0] + "/" + x.topic)));
            var indexed = courses.SelectMany((c, ci) => c.Topics.Select((topic, ti) => (Course: ci, Topic: ti, Name: topic)));
            Console.WriteLine(string.Join(" ", indexed.Where(x => x.Topic == x.Course).Select(x => $"[{x.Course},{x.Topic}]={x.Name}")));
            var slots = Enumerable.Range(0, 3).SelectMany(day => Enumerable.Range(9, 2), (day, hour) => new Slot(day, hour)).ToList();
            Console.WriteLine(string.Join(" ", slots) + " count=" + slots.Count);
            char[][] grid = { new[] { 'a', 'b' }, Array.Empty<char>(), new[] { 'c' } };
            Console.WriteLine(new string(grid.SelectMany(row => row).ToArray()) + " " + string.Concat("ab".SelectMany(_ => "xyz", (a, b) => $"{a}{b} ")).TrimEnd());

            Console.WriteLine("-- Aggregate overloads");
            Console.WriteLine(attendance.Fold((a, b) => a + b) + " " + attendance.Fold(Math.Max) + " " + rooms.Fold((a, b) => b + a) + " " + new[] { 5 }.Fold((a, b) => a * b));
            try { Console.WriteLine(Array.Empty<int>().Fold((a, b) => a + b)); }
            catch (InvalidOperationException) { Console.WriteLine("empty sequence has no fold"); }
            long factorial = Enumerable.Range(1, 15).Aggregate(1L, (product, n) => product * n);
            var histogram = courses.Aggregate(new SortedDictionary<int, int>(), (map, c) => { map[c.Topics.Count] = map.GetValueOrDefault(c.Topics.Count) + 1; return map; });
            Console.WriteLine(factorial + " " + string.Join(",", histogram.Select(p => p.Key + "x" + p.Value)));
            string sentence = courses.Aggregate(new StringBuilder(), (sb, c) => sb.Append(sb.Length == 0 ? "" : " | ").Append(c.Code).Append('(').Append(c.Topics.Count).Append(')'), sb => sb.ToString());
            Console.WriteLine(sentence);
            var (mean, deviation) = attendance.MeanAndDeviation();
            Console.WriteLine(F(mean) + " " + F(deviation) + " " + F(attendance.Where(a => a > 0).MeanAndDeviation().Deviation));
            int gcd = new[] { 84, 126, 210 }.Aggregate((a, b) => { while (b != 0) (a, b) = (b, a % b); return a; });
            string longest = courses.SelectMany(c => c.Topics).Aggregate("", (best, t) => t.Length > best.Length ? t : best, best => best.ToUpperInvariant());
            Console.WriteLine(gcd + " " + longest + " " + "hello".Aggregate(0u, (hash, ch) => hash * 31 + ch));

            Console.WriteLine("-- Zip");
            foreach ((Course course, int seats) in courses.Zip(attendance)) Console.WriteLine($"{course.Code,-6}{seats,3} {new string('#', seats / 4)}");
            Console.WriteLine(string.Join(" ", courses.Zip(rooms, (c, room) => c.Code + "@" + room)));
            foreach (var (course, seats, room) in courses.Zip(attendance, rooms)) Console.WriteLine($"{room}: {course.Code} x{seats}");
            var triples = courses.Zip(attendance, slots).Where(t => t.Second > 0).Select(t => t.First.Code + t.Third);
            Console.WriteLine(string.Join(" ", triples));
            int[] series = { 3, 8, 6, 15, 15, 9 };
            Console.WriteLine(string.Join(" ", series.Zip(series.Skip(1), (previous, next) => (next - previous).ToString("+0;-0;0", CultureInfo.InvariantCulture))) + " rising=" + series.Zip(series.Skip(1)).Count(p => p.Second > p.First));
            double dot = new[] { 1.5, 2.0, -0.5 }.Zip(new[] { 4.0, 0.25, 2.0 }, (x, y) => x * y).Sum();
            Console.WriteLine(F(dot) + " " + string.Join("", "abc".Zip("12345").Select(p => $"{p.First}{p.Second}")) + " " + Enumerable.Empty<int>().Zip(series).Count());
            var weighted = courses.Select((c, i) => (c, i)).Zip(attendance, (pair, seats) => pair.c.Topics.Count * seats * (pair.i + 1)).Aggregate(0, (sum, x) => sum + x);
            Console.WriteLine("weighted=" + weighted);
        }
    }
}
