using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static void Main()
    {
        int[] arr = { 1, 2, 3, 4, 5 };
        var words = new List<string> { "pear", "apple", "fig" };
        { var d = new DateTime(2024, 1, 31) + TimeSpan.FromDays(1); Console.WriteLine(d.Day + (d > DateTime.MinValue ? "y" : "n")); }
        { var span = new DateTime(2024, 3, 1) - new DateTime(2024, 2, 1); Console.WriteLine(span.Days + (span == TimeSpan.FromDays(29) ? "=" : "!")); }
        { decimal total = 0; foreach (var x in arr) total += x * 1.5m; Console.WriteLine(total.ToString(CultureInfo.InvariantCulture) + (total > 20 ? ">" : "<")); }
        { Console.WriteLine(Math.Round(2.345m, 2).ToString(CultureInfo.InvariantCulture) + decimal.MaxValue.ToString().Length); }
        { EventHandler<EventArgs> handler = (s, e) => Console.WriteLine("raised"); handler += (s, e) => Console.WriteLine("twice"); handler(null, EventArgs.Empty); }
        { Action<int, string> a = (n, s) => Console.WriteLine(s + n); a.Invoke(1, "n"); Func<string> f = 5.ToString; Console.WriteLine(f()); }
        { Func<int, Func<int, int>> add = x => y => x + y; Console.WriteLine(add(2)(3)); }
        { Console.WriteLine(words.Select(w => w.Length).Max() + words.OrderBy(w => w).First() + words.Min(w => w.Length)); }
        { Console.WriteLine(words.Select((w, i) => $"{i}:{w}").Aggregate((x, y) => x + "," + y)); }
        { Console.WriteLine(string.Join("|", words.Where(w => w.Contains('p')).Select(w => w.ToUpper()))); }
        { var lookup = words.ToLookup(w => w.Length); Console.WriteLine(lookup[4].Count() + lookup.Count); }
        { var groups = words.GroupBy(w => w[0]).Select(g => new KeyValuePair<char, int>(g.Key, g.Count())).ToList(); Console.WriteLine(groups.Count); }
        { Console.WriteLine(arr.Where(x => x > 1).TakeWhile(x => x < 5).Select(x => x * x).ToArray().Length); }
        { Console.WriteLine(arr.Cast<object>().Count() + arr.DefaultIfEmpty().Count() + arr.Append(6).Prepend(0).Count()); }
        { Console.WriteLine(arr.Chunk(2).Count() + arr.MaxBy(x => -x) + arr.ElementAt(1) + arr.LastOrDefault(x => x < 0)); }
        { var dict = words.ToDictionary(w => w, w => w.Length); foreach (var (k, v) in dict.OrderBy(p => p.Key)) Console.Write(k + v); Console.WriteLine(); }
        { var nested = new Dictionary<string, List<int>> { ["a"] = new List<int> { 1 } }; nested["a"].Add(2); Console.WriteLine(nested["a"].Count + nested.Keys.First() + nested.Values.Sum(l => l.Count)); }
        { var ro = new ReadOnlyCollection<int>(arr); Console.WriteLine(ro.Count + ro[0]); IReadOnlyList<int> rl = arr; Console.WriteLine(rl.Count); }
        { var linked = new LinkedList<int>(arr); linked.AddFirst(0); Console.WriteLine(linked.First.Value + linked.Count); }
        { var stack = new Stack<string>(); stack.Push("a"); Console.WriteLine(stack.Peek() + stack.Pop() + stack.Count + stack.TryPop(out _)); }
        { var sset = new SortedSet<int> { 3, 1, 2 }; Console.WriteLine(sset.Min + sset.Max + string.Join("", sset)); }
        { var pq = new PriorityQueue<string, int>(); pq.Enqueue("b", 2); pq.Enqueue("a", 1); Console.WriteLine(pq.Dequeue()); }
        { var bits = new BitArray(4); bits[1] = true; Console.WriteLine(bits.Count + (bits[1] ? "t" : "f")); }
        { Console.WriteLine(Regex.IsMatch("abc123", @"\d+") + Regex.Replace("a1b2", @"\d", "#") + Regex.Match("x42", @"\d+").Value); }
        { Console.WriteLine("a,b;c".Split(new[] { ',', ';' }).Length + "a b".Split(' ', StringSplitOptions.RemoveEmptyEntries)[1] + "x".PadRight(3, '.') + "Hello".ToLowerInvariant().IndexOf("l", StringComparison.Ordinal)); }
        { Console.WriteLine(string.Compare("a", "b", StringComparison.Ordinal) + "abc".CompareTo("abd") + string.CompareOrdinal("b", "a") + "A".Equals("a", StringComparison.OrdinalIgnoreCase).ToString()); }
        { Console.WriteLine($"{12.5,8:F1}|{-3,-4}|{DateTime.MinValue:yyyy}|{(arr.Length > 3 ? "long" : "short")}|{{}}"); }
        { object boxed = 3.5; Console.WriteLine(boxed is double dbl && dbl > 3 ? "double" : "other"); Console.WriteLine(boxed switch { int => "i", double v when v > 3 => "d", _ => "?" }); }
        { IComparable<int> cmp = 5; IEquatable<string> eq = "a"; IFormattable fmt = 1.5; Console.WriteLine(cmp.CompareTo(3) + (eq.Equals("a") ? "e" : "n") + fmt.ToString("F2", CultureInfo.InvariantCulture)); }
        { IEnumerable<object> objs = words; IEnumerable<IComparable> cs = words; IList<string> il = words; Console.WriteLine(objs.Count() + cs.Count() + il.IndexOf("fig")); }
        { Comparison<string> byLength = (x, y) => x.Length.CompareTo(y.Length); words.Sort(byLength); Console.WriteLine(words[0] + Comparer<string>.Create(byLength).Compare("a", "bb")); }
        { int? n = arr.Length > 10 ? 1 : null; Console.WriteLine((n ?? -1) + (n.HasValue ? "h" : "n") + n.GetValueOrDefault() + (n?.ToString() ?? "null")); }
        { var tuple = (Name: "x", Value: 2); var (name, value) = tuple; Console.WriteLine(name + value + tuple.ToString() + (tuple == ("x", 2))); }
        { ValueTuple<int, string> vt = ValueTuple.Create(1, "a"); Console.WriteLine(vt.Item1 + vt.Item2 + Tuple.Create(1, 2).Item2); }
        { var reader = new StringReader("a\nb"); string line; int count = 0; while ((line = reader.ReadLine()) != null) count++; Console.WriteLine(count); }
        { using (var ms = new MemoryStream()) { ms.WriteByte(7); ms.Position = 0; Console.WriteLine(ms.ReadByte() + ms.Length); } }
        { using (var w = new StringWriter()) { w.WriteLine("{0}+{1}", 1, 2); w.Write(3.5.ToString(CultureInfo.InvariantCulture)); Console.WriteLine(w.ToString().Replace(Environment.NewLine, "/")); } }
        { Console.WriteLine(Path.Combine("a", "b.txt").Replace('\\', '/') + Path.GetFileName("/x/y.cs") + Path.ChangeExtension("f.a", ".b")); }
        { Console.WriteLine(Convert.ToBase64String(new byte[] { 1, 2, 3 }) + Convert.ToDouble("1.5", CultureInfo.InvariantCulture) + Convert.ToChar(65) + Convert.ToBoolean(1)); }
        { Console.WriteLine(int.Parse("-12", NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture) + double.Parse("2.5", CultureInfo.InvariantCulture) + long.MaxValue.ToString("N0", CultureInfo.InvariantCulture).Length); }
        { Console.WriteLine(5.CompareTo(3) + 2.5.Equals(2.5).ToString() + 'a'.CompareTo('b') + true.ToString() + 1.0f.ToString("F1", CultureInfo.InvariantCulture) + ((byte)255).ToString("X2")); }
        { Console.WriteLine(Math.Sqrt(16) + Math.Floor(2.7) + Math.Ceiling(2.1) + Math.Min(3, 4) + Math.Sign(-2.5) + Math.Clamp(15, 0, 10) + Math.Truncate(-2.7) + Math.DivRem(7, 2, out var rem) + rem); }
        { Console.WriteLine(BitConverter.GetBytes(1).Length + BitConverter.ToInt32(new byte[] { 1, 0, 0, 0 }, 0) + Buffer.ByteLength(arr)); }
        { Console.WriteLine(Array.Exists(arr, x => x == 3) + " " + Array.TrueForAll(arr, x => x > 0) + Array.ConvertAll(arr, x => x.ToString()).Length + Array.BinarySearch(arr, 4)); var copy = (int[])arr.Clone(); Array.Reverse(copy); Array.Resize(ref copy, 2); Console.WriteLine(copy[0] + copy.Length); }
        { int[,] grid = new int[2, 3]; grid[1, 2] = 5; Console.WriteLine(grid.GetLength(1) + grid.Length + grid[1, 2] + grid.Rank); int[][] jag = { new[] { 1 }, new[] { 2, 3 } }; Console.WriteLine(jag[1].Length + jag.Sum(r => r.Sum())); }
        { var t1 = Task.FromResult(1); var t2 = Task.FromResult("x"); Task.WaitAll(t1, t2); Console.WriteLine(t1.Result + t2.Result + t1.Status + Task.WhenAny(t1).Result.Result); }
        { var tcs = new TaskCompletionSource<int>(); tcs.TrySetException(new InvalidOperationException("boom")); try { tcs.Task.Wait(); } catch (AggregateException e) { Console.WriteLine(e.InnerException.Message + tcs.Task.IsFaulted); } }
        { int counter = 0; Parallel.For(0, 10, i => Interlocked.Add(ref counter, i)); Console.WriteLine(counter + Volatile.Read(ref counter)); }
        { var ev = new ManualResetEventSlim(true); Console.WriteLine(ev.IsSet + " " + ev.Wait(0)); using var sem = new SemaphoreSlim(1); sem.Wait(); Console.WriteLine(sem.CurrentCount); sem.Release(); }
        { var type = typeof(Dictionary<,>); Console.WriteLine(type.IsGenericTypeDefinition + type.Name + typeof(int[]).GetElementType().Name + words.GetType().GetGenericArguments()[0].Name + typeof(IList<>).IsInterface); }
        { Console.WriteLine(Enum.GetName(typeof(ConsoleColor), 1) + (ConsoleColor)2 + (int)ConsoleColor.Red + ConsoleColor.Blue.CompareTo(ConsoleColor.Red) + Enum.TryParse("Green", out ConsoleColor cc) + cc); }
        { var flags = FileAccess.Read | FileAccess.Write; Console.WriteLine(flags + " " + flags.HasFlag(FileAccess.Read) + ((flags & FileAccess.Write) != 0) + (FileAccess)3 + (flags == FileAccess.ReadWrite)); }
        { try { checked { int big = int.MaxValue; big++; } } catch (OverflowException e) { Console.WriteLine(e.GetType().Name + (e is ArithmeticException)); } finally { Console.WriteLine("finally"); } }
        { try { throw new ArgumentException("msg", "p"); } catch (Exception e) when (e.Message.StartsWith("msg")) { Console.WriteLine(e.Message.Contains("p") + e.GetType().BaseType.Name + (e.StackTrace != null) + e.Data.Count); } }
        { Console.WriteLine(new Uri("https://example.com/a?b=1").Host + new Uri("https://example.com/a?b=1").Query + Uri.EscapeDataString("a b")); }
        { var lazyList = new Lazy<List<int>>(() => new List<int> { 1 }); Console.WriteLine(lazyList.IsValueCreated + " " + lazyList.Value.Count + lazyList.IsValueCreated); }
        { IDictionary<string, object> bag = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase) { ["A"] = 1 }; Console.WriteLine(bag.ContainsKey("a") + " " + bag.TryGetValue("x", out var missing) + (missing == null)); }
        { var hs = new HashSet<string>(words, StringComparer.Ordinal); hs.IntersectWith(new[] { "fig", "kiwi" }); Console.WriteLine(hs.Count + (hs.Contains("fig") ? "f" : "") + hs.IsSubsetOf(words) + hs.Overlaps(words)); }
        { var q = new Queue<(int, string)>(); q.Enqueue((1, "a")); var (qi, qs) = q.Peek(); Console.WriteLine(qi + qs + q.TryDequeue(out var item) + item.Item2); }
        { var cd = new System.Collections.Concurrent.ConcurrentDictionary<string, int>(); cd.TryAdd("a", 1); cd.AddOrUpdate("a", 1, (k, v) => v + 1); Console.WriteLine(cd["a"] + cd.GetOrAdd("b", 5)); }
        { var ob = new ObservableCollection<int>(); ob.CollectionChanged += (s, e) => Console.WriteLine(e.Action); ob.Add(1); }
        { var json = System.Text.Json.JsonSerializer.Serialize(new Dictionary<string, int> { ["a"] = 1 }); Console.WriteLine(json); }
        { var num = System.Numerics.BigInteger.Pow(2, 100); Console.WriteLine(num.ToString().Length + (num > long.MaxValue ? "big" : "small") + System.Numerics.Complex.One.Real); }
        { var v2 = new System.Numerics.Vector2(1, 2) + System.Numerics.Vector2.One; Console.WriteLine(v2.X + v2.Y + v2.Length().ToString("F1", CultureInfo.InvariantCulture)); }
        { DateOnly date = new DateOnly(2024, 2, 29); TimeOnly time = new TimeOnly(13, 5); Console.WriteLine(date.DayOfYear + time.Hour + date.AddDays(1).Month + date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)); }
        { ReadOnlyMemory<char> mem = "hello".AsMemory(1, 3); Console.WriteLine(mem.Length + mem.ToString() + mem.Span[0]); ArraySegment<int> seg = new ArraySegment<int>(arr, 1, 2); Console.WriteLine(seg.Count + seg[0] + seg.Sum()); }
        { char c = 'x'; Console.WriteLine(char.IsUpper(c) + " " + char.ToUpperInvariant(c) + (int)char.MinValue + char.IsWhiteSpace(' ') + char.IsLetterOrDigit('_') + (char)(c + 1) + c.ToString().Length + char.Parse("z")); }
        { string s = null; Console.WriteLine((s?.Length ?? 0) + (s ?? "dflt") + string.IsNullOrEmpty(s) + (s == null) + (s is null) + $"{s}".Length + string.Concat(s, "x") + (s + 1)); }
    }
}
