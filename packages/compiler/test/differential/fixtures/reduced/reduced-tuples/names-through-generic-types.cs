using System;
using System.Collections.Generic;
using System.Linq;
public sealed class Tree<T>
{
    private readonly List<T> items = new List<T>();
    public void Add(T item) => items.Add(item);
    public IEnumerable<(T Value, int Depth)> Walk()
    {
        for (int i = 0; i < items.Count; i++) yield return (items[i], i);
    }
    public (int Cost, List<T> Path)? Route(bool found) => found ? (items.Count, items) : null;
}
public sealed class Graph<TNode> where TNode : IEquatable<TNode>
{
    public bool Same(TNode a, TNode b) => a.Equals(b);
}
public static class Extensions
{
    public static (T Min, T Max) MinMax<T>(this IEnumerable<T> source) where T : IComparable<T>
    {
        T min = source.First(), max = min;
        foreach (var item in source) { if (item.CompareTo(min) < 0) min = item; if (item.CompareTo(max) > 0) max = item; }
        return (min, max);
    }
    public static (TResult First, TResult Second) Map<T, TResult>(this (T, T) pair, Func<T, TResult> map) => (map(pair.Item1), map(pair.Item2));
    public static IEnumerable<(int Index, T Item)> Indexed<T>(this IEnumerable<T> source) => source.Select((item, index) => (index, item));
    public static void Deconstruct<TKey, TValue>(this KeyValuePair<TKey, List<TValue>> pair, out TKey key, out int count, out TValue first)
    {
        key = pair.Key; count = pair.Value.Count; first = pair.Value.FirstOrDefault();
    }
}
public static class Program
{
    public static void Main()
    {
        var tree = new Tree<string>();
        tree.Add("a"); tree.Add("b");
        Console.WriteLine(string.Join(" ", tree.Walk().Select(pair => pair.Value + pair.Depth)));
        Console.WriteLine(tree.Walk().GroupBy(pair => pair.Depth % 2).Select(g => g.Count()).Sum() + " " + tree.Walk().First().Value + " " + tree.Walk().Last().Depth);
        var words = new[] { "pear", "fig", "banana" }.MinMax();
        Console.WriteLine(words.Min + " " + words.Max.Length + " " + (1.5, 2.5).Map(v => (int)(v * 2)).Second + " " + ("a", "").Map(string.IsNullOrEmpty).First);
        foreach (var (index, item) in new[] { "x", "y", "z" }.Indexed().Where(pair => pair.Index != 1)) Console.Write(index + item + " ");
        var groups = new Dictionary<string, List<double>> { ["a"] = new List<double> { 1.5, 2 }, ["b"] = new List<double>() };
        foreach (var (key, count, head) in groups) Console.Write(key + ":" + count + ":" + head + " ");
        Console.WriteLine();
        Console.WriteLine(tree.Route(true)?.Path.Count + " " + tree.Route(true).Value.Cost + " " + (tree.Route(false)?.Cost ?? -1) + " " + new Graph<(int X, int Y)>().Same((1, 2), (1, 2)));
    }
}
