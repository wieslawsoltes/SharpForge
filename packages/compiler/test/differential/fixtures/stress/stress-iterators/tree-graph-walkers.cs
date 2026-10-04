using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

public sealed class Node<T>
{
    public T Value { get; }
    public List<Node<T>> Children { get; } = new List<Node<T>>();
    public Node(T value, params Node<T>[] children) { Value = value; Children.AddRange(children); }

    public IEnumerable<T> PreOrder()
    {
        yield return Value;
        foreach (Node<T> child in Children)
            foreach (T value in child.PreOrder()) yield return value;
    }

    public IEnumerable<(T Value, int Depth)> PostOrder(int depth = 0)
    {
        foreach (Node<T> child in Children)
            foreach (var item in child.PostOrder(depth + 1)) yield return item;
        yield return (Value, depth);
    }

    public IEnumerable<T[]> Paths()
    {
        var path = new List<T>();
        return Walk(this);
        IEnumerable<T[]> Walk(Node<T> node)
        {
            path.Add(node.Value);
            try
            {
                if (node.Children.Count == 0) yield return path.ToArray();
                foreach (Node<T> child in node.Children)
                    foreach (T[] found in Walk(child)) yield return found;
            }
            finally { path.RemoveAt(path.Count - 1); }
        }
    }
}

public sealed class Bst<T> : IEnumerable<T> where T : IComparable<T>
{
    private sealed class Entry { public T Key; public Entry Left, Right; }
    private Entry root;
    public int Visited { get; private set; }

    public bool Add(T key)
    {
        ref Entry slot = ref root;
        while (slot != null)
        {
            int order = key.CompareTo(slot.Key);
            if (order == 0) return false;
            slot = ref (order < 0 ? ref slot.Left : ref slot.Right);
        }
        slot = new Entry { Key = key };
        return true;
    }

    public IEnumerator<T> GetEnumerator() => InOrder(root).GetEnumerator();
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    private static IEnumerable<T> InOrder(Entry entry)
    {
        if (entry == null) yield break;
        foreach (T key in InOrder(entry.Left)) yield return key;
        yield return entry.Key;
        foreach (T key in InOrder(entry.Right)) yield return key;
    }

    public IEnumerable<T> Descending()
    {
        var stack = new Stack<Entry>();
        for (Entry current = root; current != null || stack.Count > 0; current = current.Left)
        {
            for (; current != null; current = current.Right) stack.Push(current);
            yield return (current = stack.Pop()).Key;
        }
    }

    public IEnumerable<T> Range(T low, T high)
    {
        Visited = 0;
        return Walk(root);
        IEnumerable<T> Walk(Entry entry)
        {
            if (entry == null) yield break;
            Visited++;
            if (low.CompareTo(entry.Key) < 0) foreach (T key in Walk(entry.Left)) yield return key;
            if (low.CompareTo(entry.Key) <= 0 && high.CompareTo(entry.Key) >= 0) yield return entry.Key;
            if (high.CompareTo(entry.Key) > 0) foreach (T key in Walk(entry.Right)) yield return key;
        }
    }
}

public static class Combinatorics
{
    public static int Generated;

    public static IEnumerable<T[]> Permutations<T>(T[] items)
    {
        return Permute((T[])items.Clone(), 0);
        static IEnumerable<T[]> Permute(T[] work, int fixedCount)
        {
            if (fixedCount == work.Length) { Generated++; yield return (T[])work.Clone(); yield break; }
            for (int i = fixedCount; i < work.Length; i++)
            {
                (work[fixedCount], work[i]) = (work[i], work[fixedCount]);
                foreach (T[] permutation in Permute(work, fixedCount + 1)) yield return permutation;
                (work[fixedCount], work[i]) = (work[i], work[fixedCount]);
            }
        }
    }

    public static IEnumerable<T[]> Combinations<T>(IReadOnlyList<T> items, int size, int start = 0)
    {
        if (size == 0) { yield return Array.Empty<T>(); yield break; }
        for (int i = start; i <= items.Count - size; i++)
            foreach (T[] rest in Combinations(items, size - 1, i + 1)) yield return rest.Prepend(items[i]).ToArray();
    }

    public static IEnumerable<int[]> Queens(int size)
    {
        var columns = new int[size];
        return Place(0);
        bool Safe(int row, int column) => Enumerable.Range(0, row).All(r => columns[r] != column && Math.Abs(columns[r] - column) != row - r);

        IEnumerable<int[]> Place(int row)
        {
            if (row == size) { yield return (int[])columns.Clone(); yield break; }
            for (int column = 0; column < size; column++)
            {
                if (!Safe(row, column)) continue;
                columns[row] = column;
                foreach (int[] solution in Place(row + 1)) yield return solution;
            }
        }
    }
}

public sealed class Graph
{
    private readonly SortedDictionary<string, List<string>> edges = new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
    private List<string> Targets(string node) => edges.TryGetValue(node, out List<string> list) ? list : edges[node] = new List<string>();
    public Graph Edge(string from, string to) { Targets(from).Add(to); Targets(to); return this; }

    public IEnumerable<string> DepthFirst(string start)
    {
        var seen = new HashSet<string>();
        return Visit(start);
        IEnumerable<string> Visit(string node)
        {
            if (!seen.Add(node)) yield break;
            yield return node;
            foreach (string next in edges[node])
                foreach (string reached in Visit(next)) yield return reached;
        }
    }

    public IEnumerable<string> TopologicalOrder()
    {
        var incoming = edges.Keys.ToDictionary(node => node, node => edges.Values.Count(targets => targets.Contains(node)));
        var ready = new Queue<string>(incoming.Where(pair => pair.Value == 0).Select(pair => pair.Key).OrderBy(n => n, StringComparer.Ordinal));
        int emitted = 0;
        while (ready.Count > 0)
        {
            string node = ready.Dequeue();
            emitted++;
            yield return node;
            foreach (string next in edges[node]) if (--incoming[next] == 0) ready.Enqueue(next);
        }
        if (emitted != edges.Count) throw new InvalidOperationException("cycle detected after " + emitted + " nodes");
    }

    public IEnumerable<string> PathsBetween(string from, string to, string prefix = "")
    {
        string path = prefix + from;
        if (from == to) { yield return path; yield break; }
        foreach (string next in edges[from].Where(next => !path.Contains(next)))
            foreach (string found in PathsBetween(next, to, path + ">")) yield return found;
    }
}

public static class Program
{
    public static void Main()
    {
        var tree = new Node<string>("root", new Node<string>("a", new Node<string>("a1"), new Node<string>("a2", new Node<string>("a2x"))), new Node<string>("b"), new Node<string>("c", new Node<string>("c1")));
        Console.WriteLine("pre:   " + string.Join(" ", tree.PreOrder()));
        Console.WriteLine("post:  " + string.Join(" ", tree.PostOrder().Select(item => item.Value + "/" + item.Depth)));
        Console.WriteLine("leaves: " + string.Join(" ", tree.Paths().Select(path => path[^1])) + " | deepest " + tree.PostOrder().MaxBy(item => item.Depth).Value);
        Console.WriteLine("paths: " + string.Join(" | ", tree.Paths().Select(path => string.Join(">", path))) + " | first only: " + string.Join(">", tree.Paths().First()));

        var bst = new Bst<int>();
        int added = new[] { 50, 30, 70, 20, 40, 60, 80, 30, 65, 10, 45, 70 }.Count(bst.Add);
        Console.WriteLine("bst added " + added + ": " + string.Join(",", bst) + " | desc top3: " + string.Join(",", bst.Descending().Take(3)));
        Console.WriteLine("range 35..65: " + string.Join(",", bst.Range(35, 65)) + " visited " + bst.Visited + " | range 0..15: " + string.Join(",", bst.Range(0, 15)) + " visited " + bst.Visited);

        Console.WriteLine("permutations: " + string.Join(" ", Combinatorics.Permutations("abc".ToCharArray()).Select(p => new string(p))) + " generated=" + Combinatorics.Generated);
        char[] firstMatch = Combinatorics.Permutations("abcde".ToCharArray()).First(p => p[0] == 'b' && p[4] == 'a');
        Console.WriteLine("lazy search: " + new string(firstMatch) + " after generated=" + Combinatorics.Generated + " of " + (6 + 120));
        Console.WriteLine("combinations 3 of 5: " + string.Join(" ", Combinatorics.Combinations(new[] { 1, 2, 3, 4, 5 }, 3).Select(c => string.Concat(c))));
        Console.WriteLine("counts: " + string.Join(",", Enumerable.Range(0, 6).Select(k => Combinatorics.Combinations("abcde".ToCharArray(), k).Count())));
        Console.WriteLine("queens: " + string.Join(" ", Enumerable.Range(1, 7).Select(n => n + ":" + Combinatorics.Queens(n).Count())) + " | first 6x6: " + string.Concat(Combinatorics.Queens(6).First()));

        var graph = new Graph().Edge("shirt", "tie").Edge("tie", "jacket").Edge("trousers", "shoes").Edge("trousers", "belt").Edge("belt", "jacket").Edge("shirt", "belt").Edge("socks", "shoes");
        Console.WriteLine("dfs: " + string.Join(" ", graph.DepthFirst("shirt")) + " | from trousers: " + string.Join(" ", graph.DepthFirst("trousers")));
        Console.WriteLine("topological: " + string.Join(" ", graph.TopologicalOrder()));
        Console.WriteLine("paths shirt->jacket: " + string.Join(" , ", graph.PathsBetween("shirt", "jacket")) + " | none: " + graph.PathsBetween("socks", "tie").Count());
        graph.Edge("jacket", "shirt");
        var partial = new List<string>();
        try { foreach (string node in graph.TopologicalOrder()) partial.Add(node); }
        catch (InvalidOperationException e) { Console.WriteLine("with cycle: " + string.Join(" ", partial) + " then " + e.Message); }
        Console.WriteLine("cycle-safe dfs: " + string.Join(" ", graph.DepthFirst("jacket")) + " | paths jacket->belt: " + string.Join(" , ", graph.PathsBetween("jacket", "belt")));
    }
}
