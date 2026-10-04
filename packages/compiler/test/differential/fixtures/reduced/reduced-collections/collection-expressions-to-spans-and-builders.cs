using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Runtime.CompilerServices;

[CollectionBuilder(typeof(Bag), nameof(Bag.Create))]
public class Bag<T> : IEnumerable<T>
{
    private readonly T[] _items;
    public Bag(T[] items) { _items = items; }
    public int Count => _items.Length;
    public IEnumerator<T> GetEnumerator() => ((IEnumerable<T>)_items).GetEnumerator();
    IEnumerator IEnumerable.GetEnumerator() => _items.GetEnumerator();
}
public static class Bag
{
    public static Bag<T> Create<T>(ReadOnlySpan<T> items) => new Bag<T>(items.ToArray());
}

class P {
  static int Sum(ReadOnlySpan<int> values) { int s = 0; foreach (var v in values) s += v; return s; }
  static IEnumerable<int> Evens() { yield return 2; yield return 4; }
  static void Main() {
    int[] a = [1, 2, 3];
    List<int> l = [0, ..a, 9];
    Span<int> s = [1, 2, 3];
    ReadOnlySpan<int> r = [4, 5, ..a];
    ImmutableArray<string> names = ["zed", "amy", "Bob"];
    ImmutableArray<int> spread = [..a, ..l, 7];
    ImmutableList<int> il = [1, ..Evens()];
    IEnumerable<int> e = [..a, ..Evens()];
    IReadOnlyList<int> rl = [5, 6];
    Bag<int> bag = [1, ..a, ..Evens()];
    Bag<string> empty = [];
    HashSet<int> hs = [1, 1, 2];
    int[] viaSpread = [..Evens(), ..s];
    Console.WriteLine(Sum(s) + " " + Sum(r) + " " + Sum([1, 2]) + " " + names.Add("x").Length + " " + string.Join(",", spread));
    Console.WriteLine(string.Join(",", il) + " " + string.Join(",", e) + " " + rl.Count + " " + bag.Count + " " + string.Join(",", bag) + " " + empty.Count);
    Console.WriteLine(hs.Count + " " + string.Join(",", viaSpread) + " " + string.Join(",", l));
    int[][] jag = [[1], [2, 3], []];
    Console.WriteLine(jag.Sum(x => x.Length));
  }
}
