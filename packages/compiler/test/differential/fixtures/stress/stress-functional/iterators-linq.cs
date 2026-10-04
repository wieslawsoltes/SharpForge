using System;
using System.Collections.Generic;
using System.Linq;

public sealed class Tree<T> where T : IComparable<T>
{
    private sealed class Node
    {
        public T Value;
        public Node Left, Right;
    }

    private Node root;
    public int Count { get; private set; }

    public bool Add(T value)
    {
        ref Node slot = ref root;
        while (slot != null)
        {
            int order = value.CompareTo(slot.Value);
            if (order == 0) return false;
            if (order < 0) slot = ref slot.Left; else slot = ref slot.Right;
        }
        slot = new Node { Value = value };
        Count++;
        return true;
    }

    public IEnumerable<T> InOrder() => Walk(root);

    private static IEnumerable<T> Walk(Node node)
    {
        if (node == null) yield break;
        foreach (var value in Walk(node.Left)) yield return value;
        yield return node.Value;
        foreach (var value in Walk(node.Right)) yield return value;
    }

    public IEnumerable<(T Value, int Depth)> BreadthFirst()
    {
        var queue = new Queue<(Node, int)>();
        if (root != null) queue.Enqueue((root, 0));
        while (queue.Count > 0)
        {
            var (node, depth) = queue.Dequeue();
            yield return (node.Value, depth);
            if (node.Left != null) queue.Enqueue((node.Left, depth + 1));
            if (node.Right != null) queue.Enqueue((node.Right, depth + 1));
        }
    }
}

public static class Sequences
{
    public static IEnumerable<int> Fibonacci()
    {
        int a = 0, b = 1;
        while (true)
        {
            yield return a;
            (a, b) = (b, a + b);
        }
    }

    public static IEnumerable<int> Primes(int limit)
    {
        var composite = new bool[limit + 1];
        for (int n = 2; n <= limit; n++)
        {
            if (composite[n]) continue;
            yield return n;
            for (long multiple = (long)n * n; multiple <= limit; multiple += n) composite[multiple] = true;
        }
    }

    public static IEnumerable<IReadOnlyList<T>> Batch<T>(this IEnumerable<T> source, int size)
    {
        var batch = new List<T>(size);
        foreach (var item in source)
        {
            batch.Add(item);
            if (batch.Count == size)
            {
                yield return batch;
                batch = new List<T>(size);
            }
        }
        if (batch.Count > 0) yield return batch;
    }

    public static IEnumerable<TResult> Pairwise<T, TResult>(this IEnumerable<T> source, Func<T, T, TResult> combine)
    {
        using var enumerator = source.GetEnumerator();
        if (!enumerator.MoveNext()) yield break;
        T previous = enumerator.Current;
        while (enumerator.MoveNext())
        {
            yield return combine(previous, enumerator.Current);
            previous = enumerator.Current;
        }
    }

    public static IEnumerable<T> Trace<T>(this IEnumerable<T> source, string label, List<string> log)
    {
        log.Add(label + ":start");
        try
        {
            foreach (var item in source)
            {
                log.Add(label + ":" + item);
                yield return item;
            }
        }
        finally
        {
            log.Add(label + ":end");
        }
    }

    public static IEnumerable<string> Permutations(string letters)
    {
        if (letters.Length <= 1)
        {
            yield return letters;
            yield break;
        }
        for (int i = 0; i < letters.Length; i++)
        {
            foreach (var rest in Permutations(letters.Remove(i, 1))) yield return letters[i] + rest;
        }
    }
}

public static class Program
{
    public static void Main()
    {
        Console.WriteLine(string.Join(" ", Sequences.Fibonacci().Take(15)));
        Console.WriteLine(string.Join(" ", Sequences.Fibonacci().Where(n => n % 2 == 0).SkipWhile(n => n < 10).TakeWhile(n => n < 5000)));
        Console.WriteLine(string.Join(" ", Sequences.Primes(60)) + " | " + Sequences.Primes(1000).Count() + " " + Sequences.Primes(1000).Last());
        Console.WriteLine(string.Join(" | ", Enumerable.Range(1, 10).Batch(4).Select(b => string.Join(",", b) + "=" + b.Sum())));
        Console.WriteLine(string.Join(" ", Sequences.Fibonacci().Take(10).Pairwise((a, b) => b - a)) + " " + new int[0].Pairwise((a, b) => a + b).Count());

        var log = new List<string>();
        var traced = Enumerable.Range(1, 6).Trace("src", log).Where(n => n % 2 == 1).Trace("odd", log).Select(n => n * n);
        Console.WriteLine("deferred: " + log.Count);
        Console.WriteLine(traced.First(n => n > 5) + " after " + log.Count + ": " + string.Join(" ", log));
        log.Clear();
        Console.WriteLine(traced.Sum() + " " + string.Join(" ", log.Where(entry => entry.EndsWith("end") || entry.EndsWith("start"))));

        var tree = new Tree<string>();
        foreach (var word in "the quick brown fox jumps over the lazy dog".Split(' ')) Console.Write(tree.Add(word) ? "+" : "-");
        Console.WriteLine(" " + tree.Count);
        Console.WriteLine(string.Join(" ", tree.InOrder()));
        Console.WriteLine(string.Join(" ", tree.BreadthFirst().Select(pair => pair.Value + pair.Depth)));
        Console.WriteLine(tree.BreadthFirst().GroupBy(pair => pair.Depth).Select(g => g.Count()).Aggregate("", (text, n) => text + n));

        Console.WriteLine(string.Join(",", Sequences.Permutations("abc")) + " " + Sequences.Permutations("abcd").Count(p => p[0] < p[3]));
        var matrix = new[] { new[] { 1, 2, 3 }, new[] { 4, 5 }, new int[0], new[] { 6 } };
        Console.WriteLine(string.Join("", matrix.SelectMany((row, index) => row.Select(v => v * (index + 1)))) + " " + matrix.Max(row => row.Length) + " " + matrix.Any(row => !row.Any()) + " " + matrix.All(row => row.Length < 4));
        var cross = from x in Enumerable.Range(1, 4) from y in Enumerable.Range(x, 4 - x + 1) where (x + y) % 3 == 0 select (x, y);
        Console.WriteLine(string.Join(" ", cross) + " " + Enumerable.Repeat("ab", 3).Aggregate(string.Concat) + " " + Enumerable.Empty<int>().DefaultIfEmpty(-1).Single());
        var enumerator = Sequences.Fibonacci().GetEnumerator();
        int moved = 0;
        while (enumerator.MoveNext() && enumerator.Current < 100) moved++;
        enumerator.Dispose();
        Console.WriteLine(moved + " " + enumerator.Current + " " + Enumerable.Range(0, 20).Reverse().Skip(3).Take(3).Average() + " " + new[] { 3, 1, 2 }.OrderBy(v => v).SequenceEqual(new[] { 1, 2, 3 }));
    }
}
