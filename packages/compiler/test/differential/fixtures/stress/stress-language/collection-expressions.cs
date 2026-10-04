using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Runtime.CompilerServices;

int[] primes = [2, 3, 5, 7];
List<int> evens = [0, 2, 4];
ReadOnlySpan<int> merged = [.. primes, .. evens, 11];
Span<int> scratch = [1, 2, 3];
scratch.Reverse();
ImmutableArray<string> names = ["carol", "alice"];
ImmutableArray<string> moreNames = [.. names, "bob", .. names.Select(n => n.ToUpperInvariant())];
IEnumerable<int> filtered = [.. primes.Where(p => p > 2), .. scratch, 99];
IReadOnlyList<string> none = [];
HashSet<string> unique = ["a", "b", "a", .. moreNames.Select(n => n[..1])];
int[][] jagged = [[1], [2, 3], [], [.. primes]];
Bag<string> bag = ["x", .. names, "y"];
Bag<int> emptyBag = [];
Tally tally = [1, 2, 2, 3, .. evens, .. merged];
Console.WriteLine(string.Join(",", merged.ToArray()) + " | " + string.Join(",", scratch.ToArray()) + " | " + string.Join(",", moreNames) + " | " + string.Join(",", filtered));
Console.WriteLine($"{none.Count} {string.Join("", unique.OrderBy(u => u, StringComparer.Ordinal))} {string.Join("/", jagged.Select(row => row.Length))} {bag} {emptyBag} {tally} {tally.Count()}");

foreach (int[] line in (int[][])[.. jagged, [.. jagged[1], .. jagged[0]]]) Console.WriteLine("row [" + string.Join(",", line) + "] " + (line is [_, .. var rest] ? rest.Length : -1));
Console.WriteLine($"{Api.Total()} {Api.Total(5)} {Api.Total(1, 2, 3)} {Api.Total([.. primes, 10])} {Api.Total(primes)} {Api.Which(1, 2)} {Api.Which(primes)} {Api.Which()} {Api.Which([1])}");
Console.WriteLine($"{Api.JoinAll("-", 1.5m, 2m)} {Api.JoinAll<string>("+")} {Api.JoinAll("+", evens)} {Api.JoinAll(":", evens.Select(e => e * e))} {Api.JoinAll(" ", 'a', 'b')} {Api.JoinAll("~", [.. names, "z"])}");
var tags = Api.Tags("red", "green");
List<string> existing = ["blue"];
var same = Api.Tags(existing);
Console.WriteLine($"{string.Join(",", tags)} {string.Join(",", same)} {ReferenceEquals(same, existing)} {string.Join(",", Api.Tags())} {Api.Tags([.. tags, .. existing]).Count}");

Dictionary<string, List<int>> index = new() { ["odd"] = new() { 1, 3 }, ["even"] = [2, 4], ["none"] = [] };
index["odd"].AddRange([5, .. index["even"].Select(e => e + 5)]);
foreach (var (key, values) in index.OrderBy(entry => entry.Key, StringComparer.Ordinal)) Console.WriteLine(key + " = [" + string.Join(",", values) + "]");
(int Count, string Name) pair = default;
Func<int, int> transform = default;
bool verbose = index.Count > 2;
int? maybe = verbose ? index["odd"].Count : null;
IEnumerable<int> source = verbose ? primes : evens;
double ratio = verbose ? 1 : 2.5;
long[] wide = [1, 2, int.MaxValue + 1L];
object boxed = verbose ? "text" : 0;
StringComparer comparer = default;
Console.WriteLine($"{string.Join(",", index["odd"])} {pair == default} {pair.Count}{pair.Name ?? "-"} {transform is null} {maybe} {source.Sum()} {ratio} {wide[^1]} {boxed} {comparer == default} {Api.OrDefault<int>()} {Api.OrDefault("x")} {Api.OrDefault<DateTimeKind>()}");

var countdown = new Countdown { Label = "launch", Slots = { [^1] = 0, [^2] = 1, [0] = 9 }, History = { [^1] = "last", [1] = "second" } };
Console.WriteLine(countdown.Label + " " + string.Join(",", countdown.Slots) + " " + string.Join(",", countdown.History.Select(h => h ?? "_")));

var quad = new Quad();
for (int i = 0; i < 4; i++) quad[i] = (i + 1) * (i + 1);
quad[^1] += 100;
Span<int> view = quad;
view[0] = -1;
ReadOnlySpan<int> middle = quad[1..3];
int quadSum = 0;
foreach (int value in quad) quadSum += value;
Row3 row = default;
row[1] = "mid";
Console.WriteLine($"{quad[0]} {quad[3]} {quadSum} {middle.Length}:{middle[0]},{middle[^1]} {Api.Total(quad)} {row[0] ?? "null"} {row[1]} {((ReadOnlySpan<string>)row).Length}");

string word = "education";
Console.WriteLine($"{primes.Head()} {primes.Ends(7)} {scratch.Ends(1)} {merged.Head()} {word.Vowels()} {word.AsSpan(2, 3).Vowels()} {evens.ToArray().Head()} {Api.Count<int>(primes, 5)} {Api.Count<char>(word, 'u')} {Api.Count<string>([.. names, "alice"], "alice")}");
string[] strings = ["x", "y"];
object[] objects = strings;
ReadOnlySpan<object> covariant = strings;
Console.WriteLine($"{objects.Length} {covariant.Length} {covariant[1]} {Api.Describe(strings)} {Api.Describe(objects)} {Api.Describe(new List<string>(strings))} {Api.Describe(["p", "q", "r"])}");

[CollectionBuilder(typeof(Bag), nameof(Bag.Create))]
public sealed class Bag<T> : IEnumerable<T>
{
    private readonly T[] _items;
    internal Bag(T[] items) { _items = items; }
    public int Count => _items.Length;
    public IEnumerator<T> GetEnumerator() => ((IEnumerable<T>)_items).GetEnumerator();
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    public override string ToString() => "Bag<" + typeof(T).Name + ">(" + string.Join(",", _items) + ")";
}

public static class Bag
{
    public static Bag<T> Create<T>(ReadOnlySpan<T> items) => new Bag<T>(items.ToArray());
}

public sealed class Tally : IEnumerable<int>
{
    private readonly SortedDictionary<int, int> _counts = new();
    public void Add(int value) => _counts[value] = _counts.GetValueOrDefault(value) + 1;
    public IEnumerator<int> GetEnumerator() => _counts.SelectMany(p => Enumerable.Repeat(p.Key, p.Value)).GetEnumerator();
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    public override string ToString() => string.Join(" ", _counts.Select(p => p.Key + "x" + p.Value));
}

public sealed class Countdown
{
    public string Label { get; init; }
    public int[] Slots { get; } = new int[5];
    public List<string> History { get; } = new() { null, null, null };
}

[InlineArray(4)]
public struct Quad
{
    private int _element0;
}

[InlineArray(3)]
public struct Row3
{
    private string _element0;
}

public static class Api
{
    public static int Total(params ReadOnlySpan<int> values)
    {
        int total = 0;
        foreach (int value in values) total += value;
        return total;
    }

    public static string Which(params int[] values) => "array" + values.Length;
    public static string Which(params ReadOnlySpan<int> values) => "span" + values.Length;
    public static string JoinAll<T>(string separator, params IEnumerable<T> items) => "<" + string.Join(separator, items.Select(i => string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0}", i))) + ">";

    public static List<string> Tags(params List<string> tags)
    {
        tags.Add("end" + tags.Count);
        return tags;
    }

    public static T OrDefault<T>(T value = default) => value;
    public static int Count<T>(ReadOnlySpan<T> items, T wanted) where T : IEquatable<T> => items.Count(wanted);
    public static string Describe(ReadOnlySpan<object> items) => "span of " + items.Length;
    public static string Describe(IEnumerable<object> items) => "sequence of " + items.Count();

    public static T Head<T>(this ReadOnlySpan<T> span) => span.IsEmpty ? default : span[0];
    public static bool Ends<T>(this ReadOnlySpan<T> span, T last) where T : IEquatable<T> => !span.IsEmpty && span[^1].Equals(last);
    public static int Vowels(this ReadOnlySpan<char> text)
    {
        int count = 0;
        foreach (char c in text) if (c is 'a' or 'e' or 'i' or 'o' or 'u') count++;
        return count;
    }
}
