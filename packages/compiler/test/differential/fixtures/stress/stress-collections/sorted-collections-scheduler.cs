using System;
using System.Collections.Generic;
using System.Linq;

namespace Scheduling
{
    public sealed record Job(string Name, int Priority, int Arrival, int Duration);

    // Highest priority first, then earliest arrival, then name; never returns 0 for distinct jobs.
    public sealed class JobOrder : IComparer<Job>
    {
        public int Compare(Job x, Job y)
        {
            if (ReferenceEquals(x, y)) return 0;
            int result = y.Priority.CompareTo(x.Priority);
            if (result == 0) result = x.Arrival.CompareTo(y.Arrival);
            return result != 0 ? result : string.CompareOrdinal(x.Name, y.Name);
        }
    }

    public static class Program
    {
        private static string Names(IEnumerable<Job> jobs) => string.Join(" ", jobs.Select(j => j.Name));

        public static void Main()
        {
            var jobs = new[]
            {
                new Job("backup", 1, 0, 4), new Job("email", 3, 1, 2), new Job("report", 2, 1, 3), new Job("alert", 9, 4, 1),
                new Job("index", 2, 5, 2), new Job("cleanup", 1, 6, 1), new Job("billing", 5, 8, 2),
            };

            Console.WriteLine("-- SortedSet with a custom comparer");
            var ready = new SortedSet<Job>(jobs, new JobOrder());
            Console.WriteLine(Names(ready) + " | min " + ready.Min.Name + " max " + ready.Max.Name);
            Console.WriteLine(ready.Add(new Job("backup", 1, 0, 99)) + " " + ready.Add(new Job("audit", 2, 1, 1)) + " " + ready.Count + " " + ready.Contains(new Job("index", 2, 5, 0))
                + " " + (ready.TryGetValue(new Job("billing", 5, 8, 0), out Job stored) ? stored.Duration : 0));
            SortedSet<Job> middle = ready.GetViewBetween(new Job("", 3, int.MinValue, 0), new Job("", 2, int.MaxValue, 0));
            Console.WriteLine("priority 3..2: " + Names(middle) + " (" + middle.Count + ")");
            ready.Add(new Job("deploy", 3, 7, 1));
            Console.WriteLine("view sees later insert: " + Names(middle) + " | reversed " + Names(middle.Reverse()));
            Console.WriteLine("removed " + ready.RemoveWhere(j => j.Duration == 1) + ": " + Names(ready) + " | view now " + Names(middle));

            Console.WriteLine("-- run queue simulation");
            var arrivals = new SortedDictionary<int, List<Job>>();
            foreach (Job job in jobs)
            {
                if (!arrivals.TryGetValue(job.Arrival, out List<Job> batch)) arrivals.Add(job.Arrival, batch = new List<Job>());
                batch.Add(job);
            }
            Console.WriteLine(string.Join(" ", arrivals.Select(p => p.Key + ":" + p.Value.Count)) + " | first " + arrivals.First().Key + " last " + arrivals.Keys.Last() + " values " + arrivals.Values.Sum(v => v.Count));
            var runnable = new SortedSet<Job>(new JobOrder());
            var remaining = new Dictionary<Job, int>();
            var timeline = new List<string>();
            var finished = new SortedList<int, string>();
            for (int tick = 0; tick < 20 && (arrivals.Count > 0 || runnable.Count > 0); tick++)
            {
                if (arrivals.Remove(tick, out List<Job> arrived)) foreach (Job job in arrived) { runnable.Add(job); remaining[job] = job.Duration; }
                if (runnable.Count == 0) { timeline.Add("idle"); continue; }
                Job current = runnable.Min;
                timeline.Add(current.Name[..2]);
                if (--remaining[current] == 0) { runnable.Remove(current); finished.Add(tick + 1, current.Name); }
            }
            Console.WriteLine(string.Join(" ", timeline));
            foreach (KeyValuePair<int, string> done in finished) Console.WriteLine($"  t={done.Key,2} {done.Value}");

            Console.WriteLine("-- SortedList by index and key");
            var quotas = new SortedList<string, int>(StringComparer.OrdinalIgnoreCase) { { "ops", 40 }, { "Dev", 120 }, { "qa", 60 } };
            quotas["DEV"] = 150;
            quotas["build"] = 15;
            Console.WriteLine(string.Join(" ", quotas.Keys) + " | " + string.Join(" ", quotas.Values) + " | " + quotas.IndexOfKey("OPS") + " " + (quotas.IndexOfKey("none") < 0) + " " + quotas.IndexOfValue(60)
                + " " + quotas.Keys[0] + "=" + quotas.Values[0] + " " + quotas.GetKeyAtIndex(1) + "=" + quotas.GetValueAtIndex(1));
            quotas.RemoveAt(0);
            quotas.SetValueAtIndex(0, quotas.GetValueAtIndex(0) + 1);
            Console.WriteLine(quotas.TryAdd("QA", 1) + " " + quotas.Remove("qa") + " " + quotas.ContainsValue(151) + " " + string.Join(" ", quotas.Select(p => p.Key + "=" + p.Value)));
            try { quotas.Add("OPS", 0); } catch (ArgumentException) { Console.WriteLine("duplicate key rejected under the comparer"); }

            Console.WriteLine("-- descending SortedDictionary");
            var leaderboard = new SortedDictionary<int, string>(Comparer<int>.Create((a, b) => b.CompareTo(a))) { [1200] = "kai", [3400] = "lee", [2750] = "mo" };
            leaderboard[3400] += "+ray";
            leaderboard.TryAdd(900, "nu");
            Console.WriteLine(string.Join(" ", leaderboard.Select(p => p.Value + "(" + p.Key + ")")) + " | top " + leaderboard.First().Value + " | " + leaderboard.Remove(1200) + leaderboard.ContainsKey(1200) + " " + leaderboard.Keys.Max());
            foreach (var (score, who) in leaderboard.Where(p => p.Key > 1000)) Console.WriteLine($"  {who,-8}{score,5}");

            Console.WriteLine("-- SortedSet<int> ranges and set algebra");
            var free = new SortedSet<int>(Enumerable.Range(8, 12));
            free.ExceptWith(new[] { 12, 13, 16 });
            SortedSet<int> morning = free.GetViewBetween(8, 11), afternoon = free.GetViewBetween(14, 99);
            Console.WriteLine(string.Join(",", morning) + " | " + string.Join(",", afternoon) + " | " + free.Min + ".." + free.Max + " " + afternoon.Min + ".." + afternoon.Max + " " + morning.Count);
            morning.Remove(9);
            Console.WriteLine(free.Contains(9) + " " + morning.Add(9) + " " + free.Contains(9) + " " + morning.IsProperSubsetOf(free) + " " + morning.Overlaps(afternoon) + " " + free.IsSupersetOf(afternoon) + " " + free.SetEquals(morning.Union(afternoon)));
            try { morning.Add(15); } catch (ArgumentOutOfRangeException) { Console.WriteLine("a view rejects values outside its bounds"); }
            var booked = new SortedSet<int>(Comparer<int>.Create((a, b) => b - a)) { 10, 15, 9, 18 };
            booked.SymmetricExceptWith(new[] { 9, 11 });
            free.IntersectWith(booked);
            Console.WriteLine(string.Join(",", booked) + " | " + string.Join(",", free) + " | " + string.Join(",", booked.GetViewBetween(15, 10)) + " | " + booked.Min + " " + booked.Max);
            var words = new SortedSet<string>(StringComparer.Ordinal) { "pear", "Apple", "fig", "apple", "Fig" };
            Console.WriteLine(string.Join(" ", words) + " | " + string.Join(" ", words.GetViewBetween("a", "g")) + " | " + string.Join(" ", new SortedSet<string>(words, StringComparer.OrdinalIgnoreCase)));
        }
    }
}
