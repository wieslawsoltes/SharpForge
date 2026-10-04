using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

namespace Deferred
{
    // A sequence that records how often it is enumerated and how many items consumers actually pull.
    public sealed class Probe<T> : IEnumerable<T>
    {
        private readonly T[] items;
        public Probe(params T[] items) { this.items = items; }
        public int Enumerations { get; private set; }
        public int Pulled { get; private set; }
        public int Disposals { get; private set; }

        public IEnumerator<T> GetEnumerator()
        {
            Enumerations++;
            try
            {
                foreach (T item in items)
                {
                    Pulled++;
                    yield return item;
                }
            }
            finally
            {
                Disposals++;
            }
        }

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
        public string Report() => $"enumerations={Enumerations} pulled={Pulled} disposals={Disposals}";
        public void Reset() { Enumerations = 0; Pulled = 0; Disposals = 0; }
    }

    public static class Program
    {
        private static readonly List<string> Log = new List<string>();

        private static bool Trace(string stage, int value, bool result)
        {
            Log.Add(stage + value);
            return result;
        }

        private static void Flush(string label)
        {
            Console.WriteLine(label + ": " + (Log.Count == 0 ? "(nothing ran)" : string.Join(" ", Log)));
            Log.Clear();
        }

        private static void Step(string label, Probe<int> probe, object result)
        {
            Console.WriteLine($"{label,-28} => {result,-12} {probe.Report()}");
            probe.Reset();
        }

        public static void Main()
        {
            var probe = new Probe<int>(4, 8, 15, 16, 23, 42);

            Console.WriteLine("-- building a query runs nothing");
            IEnumerable<int> query = probe.Where(x => Trace("w", x, x % 2 == 0)).Select(x => { Log.Add("s" + x); return x * 10; });
            Flush("after construction");
            Step("no enumeration yet", probe, "-");
            int first = query.First();
            Flush("First()");
            Step("First", probe, first);
            Console.WriteLine(string.Join(",", query.Take(2)));
            Flush("Take(2) interleaves stages");
            probe.Reset();

            Console.WriteLine("-- how much of the source each operator pulls");
            Step("Any()", probe, probe.Any());
            Step("Any(x > 15)", probe, probe.Any(x => x > 15));
            Step("All(x < 15)", probe, probe.All(x => x < 15));
            Step("Contains(15)", probe, probe.Contains(15));
            Step("Count()", probe, probe.Count());
            Step("FirstOrDefault(x > 100)", probe, probe.FirstOrDefault(x => x > 100));
            Step("ElementAt(2)", probe, probe.ElementAt(2));
            Step("Take(3).Sum()", probe, probe.Take(3).Sum());
            Step("TakeWhile(x < 16).Count()", probe, probe.TakeWhile(x => x < 16).Count());
            Step("SkipWhile(x < 16).First()", probe, probe.SkipWhile(x => x < 16).First());
            Step("Skip(4).ToArray().Length", probe, probe.Skip(4).ToArray().Length);
            Step("TakeLast(2).First()", probe, probe.TakeLast(2).First());
            Step("OrderBy.First()", probe, probe.OrderByDescending(x => x).First());
            Step("Chunk(4).First().Length", probe, probe.Chunk(4).First().Length);
            Step("Zip with 2 items", probe, probe.Zip(new[] { 'a', 'b' }).Count());
            Step("Concat(self).Take(7)", probe, probe.Concat(probe).Take(7).Last());

            Console.WriteLine("-- multiple enumeration versus materializing");
            IEnumerable<int> evens = probe.Where(x => x % 2 == 0);
            int total = evens.Sum() + evens.Count() + evens.Max();
            Step("lazy query used 3 times", probe, total);
            List<int> cached = probe.Where(x => x % 2 == 0).ToList();
            total = cached.Sum() + cached.Count + cached.Max();
            Step("ToList() used 3 times", probe, total);
            var nested = probe.Where(x => probe.Count(y => y < x) >= 4);
            Step("correlated subquery", probe, string.Join("+", nested));

            Console.WriteLine("-- queries observe later changes");
            var basket = new List<string> { "apple", "kiwi" };
            int minimum = 5;
            IEnumerable<string> longNames = basket.Where(name => name.Length >= minimum);
            string before = string.Join(",", longNames);
            basket.Add("banana");
            minimum = 4;
            Console.WriteLine(before + " -> " + string.Join(",", longNames) + " (snapshot keeps " + longNames.ToArray().Length + ")");
            var actions = new List<Func<int>>();
            foreach (int factor in new[] { 1, 2, 3 }) actions.Add(() => probe.Take(2).Sum() * factor);
            Step("closures run on demand", probe, "-");
            Step("invoking 3 closures", probe, string.Join("/", actions.Select(a => a())));

            Console.WriteLine("-- early exit and exceptions surface on enumeration");
            IEnumerable<int> risky = probe.Select(x => 100 / (15 - x));
            Step("risky query built", probe, "-");
            try { Console.WriteLine(risky.Sum()); }
            catch (DivideByZeroException) { Step("failed at third item", probe, "div by 0"); }
            Step("prefix before the failure", probe, string.Join(",", risky.Take(2)));
            using (IEnumerator<int> cursor = probe.GetEnumerator())
            {
                cursor.MoveNext();
                cursor.MoveNext();
                Console.WriteLine("manual cursor at " + cursor.Current + " " + probe.Report());
            }
            Step("after using block", probe, "-");
            IEnumerable<int> Naturals() { for (int n = 1; ; n++) { Log.Add("n" + n); yield return n; } }
            Console.WriteLine(string.Join(" ", Naturals().Where(n => n % 3 == 0).Select(n => n * n).Take(2)));
            Flush("infinite source stops");
        }
    }
}
