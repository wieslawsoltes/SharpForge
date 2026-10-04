using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static void Main()
    {
        int[] arr = { 1, 2, 3, 4, 5 };
        { var gate = new Lock(); lock (gate) { Console.WriteLine("locked"); } }
        { var gate = new Lock(); using (gate.EnterScope()) { Console.WriteLine(gate.IsHeldByCurrentThread); } }
        { var gate = new object(); lock (gate) { Console.WriteLine(Monitor.IsEntered(gate)); } }
        { Index last = ^1; Console.WriteLine(arr[last] + last.Value); }
        { Range middle = 1..^1; Console.WriteLine(arr[middle].Length); }
        { Console.WriteLine(new Range(1, 3).Start.Value + (..2).End.Value); }
        { Console.WriteLine("hello"[1..^1]); }
        { var (offset, length) = (1..4).GetOffsetAndLength(5); Console.WriteLine(offset + length); }
        { FormattableString f = $"{1} and {"two"}"; Console.WriteLine(f.Format + f.ArgumentCount + f.GetArgument(1)); }
        { FormattableString f = $"{1.5}"; Console.WriteLine(f.ToString(CultureInfo.InvariantCulture)); }
        { Console.WriteLine(FormattableString.Invariant($"{2.5:F2}")); }
        { IFormattable f = $"{3}"; Console.WriteLine(f.ToString(null, CultureInfo.InvariantCulture)); }
        { Console.WriteLine(Task.FromResult(4).Result); }
        { Console.WriteLine(Task.WhenAll(Task.FromResult(1), Task.FromResult(2)).Result.Sum()); }
        { var v = new ValueTask<int>(6); Console.WriteLine(v.IsCompleted && v.Result == 6); }
        { Console.WriteLine(Task.CompletedTask.IsCompletedSuccessfully); }
        { var source = new TaskCompletionSource<string>(); source.SetResult("done"); Console.WriteLine(source.Task.Result); }
        { var cts = new CancellationTokenSource(); cts.Cancel(); Console.WriteLine(cts.Token.IsCancellationRequested); }
        { Console.WriteLine(Interlocked.Increment(ref arr[0])); }
        { Console.WriteLine(TimeSpan.FromSeconds(90).TotalMinutes.ToString(CultureInfo.InvariantCulture)); }
        { Console.WriteLine(new DateTime(2024, 2, 29).AddDays(1).Month); }
        { Console.WriteLine(Guid.Empty.ToString().Length); }
        { Console.WriteLine(Math.Round(2.5) + Math.Abs(-3) + Math.Max(1L, 2L)); }
        { Console.WriteLine(Convert.ToInt32("17") + Convert.ToString(255, 16)); }
        { Console.WriteLine(new Version(1, 2, 3).Minor); }
        { Console.WriteLine(Environment.NewLine.Length > 0); }
        { Console.WriteLine(string.Format(CultureInfo.InvariantCulture, "{0:N1}|{1,4}|{2:X}", 1234.5, 7, 255)); }
        { Console.WriteLine(string.Format("{0} {1} {2} {3}", 1, 2, 3, 4)); }
        { Console.WriteLine($"{1.5.ToString(CultureInfo.InvariantCulture)} {arr.Length,3} {255:X4}"); }
        { var tuple = Tuple.Create(1, "a"); Console.WriteLine(tuple.Item2 + tuple.Item1); }
        { var kv = new KeyValuePair<string, int>("k", 2); Console.WriteLine(kv.Key + kv.Value); }
        { var set = new HashSet<int>(arr); set.UnionWith(new[] { 9 }); Console.WriteLine(set.Count); }
        { var queue = new Queue<int>(); queue.Enqueue(1); Console.WriteLine(queue.Dequeue() + queue.Count); }
        { var sorted = new SortedDictionary<string, int> { ["b"] = 2, ["a"] = 1 }; Console.WriteLine(sorted.First().Key); }
        { var list = new List<int>(arr); list.AddRange(new[] { 6, 7 }); list.RemoveAll(x => x % 2 == 0); Console.WriteLine(list.Count); }
        { var list = arr.ToList(); list.Sort((a, b) => b.CompareTo(a)); Console.WriteLine(list[0]); }
        { var list = new List<string> { "b", "a" }; list.Sort(); Console.WriteLine(list.BinarySearch("b") + list.Find(s => s == "a")); }
        { Array.Sort(arr, (a, b) => b - a); Console.WriteLine(arr[0] + Array.IndexOf(arr, 3)); }
        { Console.WriteLine(Array.Empty<int>().Length + Array.FindIndex(arr, x => x > 2)); }
        { Func<int, int> twice = x => x * 2; Action<string> print = Console.WriteLine; print(twice(4).ToString()); }
        { Predicate<int> even = x => x % 2 == 0; Comparison<int> cmp = (a, b) => a - b; Console.WriteLine(even(2) && cmp(1, 2) < 0); }
        { var lazy = new Lazy<int>(() => 42); Console.WriteLine(lazy.Value); }
        { int? maybe = null; Console.WriteLine(maybe.HasValue || maybe.GetValueOrDefault(3) == 3); }
        { Console.WriteLine(Nullable.GetUnderlyingType(typeof(int?)) == typeof(int)); }
        { Console.WriteLine(typeof(List<int>).Name + typeof(string).IsClass); }
        { object o = 5; Console.WriteLine(o.GetType() == typeof(int) && o.Equals(5) && o.GetHashCode() == 5); }
        { Console.WriteLine(new StringBuilder().AppendJoin(',', arr).ToString()); }
        { Console.WriteLine(Encoding.UTF8.GetBytes("é").Length + Encoding.UTF8.GetString(new byte[] { 65 })); }
        { Console.WriteLine(BitConverter.ToString(new byte[] { 1, 255 })); }
        { Console.WriteLine(char.GetNumericValue('7') + (int)Math.Pow(2, 10)); }
        { Console.WriteLine(decimal.Parse("1.5", CultureInfo.InvariantCulture) + 2m); }
        { decimal d = 10m / 4; Console.WriteLine(d.ToString(CultureInfo.InvariantCulture)); }
        { Console.WriteLine(DateTimeOffset.UnixEpoch.Year + TimeSpan.Zero.Ticks); }
        { Console.WriteLine(StringComparer.OrdinalIgnoreCase.Equals("a", "A")); }
        { Console.WriteLine(EqualityComparer<int>.Default.Equals(1, 1) && Comparer<int>.Default.Compare(1, 2) < 0); }
        { IDisposable resource = new System.IO.StringReader("x"); using (resource) { Console.WriteLine("used"); } }
        { using var reader = new System.IO.StringReader("line1\nline2"); Console.WriteLine(reader.ReadLine()); }
        { var writer = new System.IO.StringWriter(); writer.Write(12); writer.Write('c'); Console.WriteLine(writer.ToString()); }
        { Console.WriteLine(System.IO.Path.GetExtension("a/b.txt") + System.IO.Path.GetFileNameWithoutExtension("a/b.txt")); }
        { WeakReference<string> weak = new WeakReference<string>("x"); Console.WriteLine(weak.TryGetTarget(out var target) && target == "x"); }
        { var e = ((IEnumerable<int>)arr).GetEnumerator(); e.MoveNext(); Console.WriteLine(e.Current); e.Dispose(); }
        { Console.WriteLine(nameof(Console.WriteLine) + HashCode.Combine(1, 2).GetType().Name); }
        { Console.WriteLine(Enum.GetNames(typeof(DayOfWeek)).Length + Enum.GetValues<DayOfWeek>().Length); }
        { Console.WriteLine(DayOfWeek.Monday.ToString() + (DayOfWeek.Monday | DayOfWeek.Tuesday) + DayOfWeek.Friday.HasFlag(DayOfWeek.Monday)); }
        { Console.WriteLine(Enum.Parse<DayOfWeek>("Friday") + "" + Enum.IsDefined(typeof(DayOfWeek), 3)); }
    }
}
