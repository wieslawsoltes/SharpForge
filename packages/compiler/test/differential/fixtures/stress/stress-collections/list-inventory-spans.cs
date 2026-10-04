using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

var stock = new List<Item>
{
    new Item("WH2-B07-0310", "hinge", 120, 0.85m), new Item("WH1-A01-0042", "bolt", 900, 0.05m), new Item("WH3-C11-0007", "motor", 4, 149.00m),
    new Item("WH1-A02-0099", "washer", 0, 0.02m), new Item("WH2-A17-0150", "bracket", 35, 2.40m), new Item("WH1-C03-0500", "gear", 18, 12.75m),
};
string Skus(IEnumerable<Item> items) => string.Join(" ", items.Select(i => i.Name));
string M(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);

Console.WriteLine("-- List<T> sorting and searching");
var bySku = Comparer<Item>.Create((a, b) => string.CompareOrdinal(a.Sku, b.Sku));
stock.Sort(bySku);
Console.WriteLine(Skus(stock));
int found = stock.BinarySearch(new Item("WH2-A17-0150", null, 0, 0), bySku);
int missing = stock.BinarySearch(new Item("WH2-A99-0000", null, 0, 0), bySku);
Console.WriteLine($"found at {found}, missing would insert at {~missing}, in tail range: {stock.BinarySearch(3, 3, new Item("WH3-C11-0007", null, 0, 0), bySku)}");
stock.Insert(~missing, new Item("WH2-A99-0000", "spring", 60, 0.30m));
stock.Sort((a, b) => b.Value.CompareTo(a.Value));
Console.WriteLine(Skus(stock) + " | " + string.Join(" ", stock.ConvertAll(i => M(i.Value))));
stock.Sort(1, 4, Comparer<Item>.Create((a, b) => a.Quantity - b.Quantity));
Console.WriteLine(Skus(stock));

Console.WriteLine("-- predicates");
Predicate<Item> cheap = i => i.Price < 1m;
Console.WriteLine(Skus(stock.FindAll(cheap)) + " | " + stock.Find(cheap).Name + " " + stock.FindLast(cheap).Name + " " + stock.FindIndex(cheap) + " " + stock.FindIndex(3, cheap) + " " + stock.FindLastIndex(cheap) + " " + ~stock.FindIndex(i => i.Quantity > 5000)
    + " " + (stock.Find(i => i.Quantity > 5000) == null) + " " + stock.Exists(i => i.Quantity == 0) + " " + stock.TrueForAll(i => i.Price > 0) + " " + stock.TrueForAll(i => i.Quantity > 0));
var warehouses = new SortedDictionary<string, int>(StringComparer.Ordinal);
stock.ForEach(i => warehouses[i.Sku[..3]] = warehouses.GetValueOrDefault(i.Sku[..3]) + i.Quantity);
Console.WriteLine(string.Join(" ", warehouses.Select(p => p.Key + "=" + p.Value)) + " | removed " + stock.RemoveAll(i => i.Quantity == 0) + " then " + stock.RemoveAll(i => i.Quantity == 0) + " | " + stock.Count);

Console.WriteLine("-- ranges");
List<Item> middle = stock.GetRange(1, 3);
stock.RemoveRange(1, 3);
Console.WriteLine(Skus(stock) + " | " + Skus(middle));
middle.Reverse();
stock.InsertRange(1, middle);
stock.AddRange(middle.Take(1));
Console.WriteLine(Skus(stock) + " | first/last index of " + middle[0].Name + ": " + stock.IndexOf(middle[0]) + "/" + stock.LastIndexOf(middle[0]) + " | " + stock.Contains(middle[0] with { Quantity = 1 }));
stock.Reverse(0, 3);
stock.RemoveAt(stock.Count - 1);
var copy = new Item[stock.Count + 2];
stock.CopyTo(1, copy, 2, 3);
Console.WriteLine(Skus(stock) + " | " + string.Join(",", copy.Select(i => i?.Name ?? "_")) + " | " + Skus(stock.Slice(2, 2)) + " | " + Skus(stock[^2..]) + " | " + stock.AsReadOnly().Count + " " + (stock.Capacity >= stock.Count));

Console.WriteLine("-- Span<T> windows over one array");
int[] bins = { 12, 7, 31, 4, 25, 18, 9, 40 };
Span<int> all = bins;
Span<int> window = bins.AsSpan(2, 4);
window.Sort();
Console.WriteLine(string.Join(",", bins) + " | " + window.BinarySearch(25) + " " + (window.BinarySearch(5) < 0) + " " + window.IndexOf(18) + " " + all.IndexOf(18) + " " + window.Contains(40) + " " + all[^1] + " " + window[1..^1].Length);
window[..2].Reverse();
all[..2].Fill(1);
all.Slice(6).Clear();
Console.WriteLine(string.Join(",", bins) + " | max " + Largest<int>(all) + " window max " + Largest<int>(window) + " | " + all.StartsWith(new[] { 1, 1 }) + " " + window.SequenceEqual(bins.AsSpan()[2..6]) + " " + all.Overlaps(window) + " " + all.LastIndexOf(1) + " " + all.Count(1));
Span<int> scratch = stackalloc int[5];
bool copied = window.TryCopyTo(scratch), tooSmall = all.TryCopyTo(scratch);
scratch[^1] = Sum(scratch[..4]);
Console.WriteLine(copied + " " + tooSmall + " " + string.Join(",", scratch.ToArray()) + " | " + Sum(bins) + " " + Sum(new ReadOnlySpan<int>(bins, 1, 2)) + " " + Sum(default));
ref int slot = ref all[3];
slot += 1000;
foreach (ref int bin in window) bin *= 2;
Console.WriteLine(string.Join(",", bins));

Console.WriteLine("-- ReadOnlySpan<char> parsing without substrings");
foreach (Item item in stock.Take(3))
{
    ReadOnlySpan<char> sku = item.Sku;
    int dash = sku.IndexOf('-'), lastDash = sku.LastIndexOf('-');
    ReadOnlySpan<char> warehouse = sku[..dash], shelf = sku.Slice(dash + 1, lastDash - dash - 1), serial = sku[(lastDash + 1)..];
    int number = int.Parse(serial, NumberStyles.None, CultureInfo.InvariantCulture);
    Console.WriteLine($"  {item.Name,-8} wh={warehouse[^1]} aisle={shelf[0]} shelf={int.Parse(shelf[1..], NumberStyles.None, CultureInfo.InvariantCulture),2} serial={number,3} trimmed={serial.TrimStart('0').ToString()} {warehouse.SequenceEqual("WH1")} {sku.StartsWith("WH2", StringComparison.Ordinal)}");
}

Console.WriteLine("-- Memory<T>, ReadOnlyMemory<T>, ArraySegment<T>");
Memory<int> memory = bins.AsMemory(1, 5);
Memory<int> tail = memory.Slice(3);
tail.Span[0] = 100 + tail.Length;
memory.Span.Slice(0, 2).Fill(77);
ReadOnlyMemory<char> text = "inventory-report".AsMemory();
ReadOnlyMemory<char> word = text[(text.Span.IndexOf('-') + 1)..];
Console.WriteLine(string.Join(",", bins.Select(b => b.ToString(CultureInfo.InvariantCulture))) + " | " + memory.Length + " " + tail.Length + " " + memory.IsEmpty + Memory<int>.Empty.IsEmpty + " " + word.ToString() + " " + text.Slice(0, 3).ToString() + word.Length + " " + new string(word.ToArray().Reverse().ToArray()) + " " + memory.ToArray().Length);
var segment = new ArraySegment<int>(bins, 2, 4);
ArraySegment<int> inner = segment.Slice(1, 2);
inner[0] = 5;
int total = 0;
foreach (int value in segment) total += value;
Console.WriteLine(segment.Offset + " " + segment.Count + " " + inner.Offset + " " + segment[1] + " " + bins[3] + " " + total + " " + segment.Sum() + " " + string.Join(",", inner.ToArray()) + " " + (segment.Array == bins) + " " + segment.AsSpan().IndexOf(5) + " " + ((IList<int>)segment).IndexOf(5) + " " + new ArraySegment<int>(bins).Count + " " + ArraySegment<int>.Empty.Count);

static T Largest<T>(ReadOnlySpan<T> values) where T : IComparable<T>
{
    T best = values[0];
    foreach (T value in values[1..]) if (value.CompareTo(best) > 0) best = value;
    return best;
}

static int Sum(ReadOnlySpan<int> values)
{
    int sum = 0;
    for (int i = 0; i < values.Length; i++) sum += values[i];
    return sum;
}

public sealed record Item(string Sku, string Name, int Quantity, decimal Price)
{
    public decimal Value => Quantity * Price;
}
