using System;
using System.Collections.Generic;
using System.Linq;

public sealed class Heap<TItem, TPriority> where TPriority : IComparable<TPriority>
{
    private readonly List<(TItem Item, TPriority Priority)> entries = new List<(TItem, TPriority)>();
    private readonly bool descending;
    public Heap(bool descending = false) { this.descending = descending; }
    public int Count => entries.Count;

    private bool Before(int a, int b)
    {
        int order = entries[a].Priority.CompareTo(entries[b].Priority);
        return descending ? order > 0 : order < 0;
    }

    private void Swap(int a, int b) => (entries[a], entries[b]) = (entries[b], entries[a]);

    public void Push(TItem item, TPriority priority)
    {
        entries.Add((item, priority));
        int child = entries.Count - 1;
        while (child > 0)
        {
            int parent = (child - 1) / 2;
            if (!Before(child, parent)) break;
            Swap(child, parent);
            child = parent;
        }
    }

    public bool TryPop(out TItem item, out TPriority priority)
    {
        if (entries.Count == 0) { item = default; priority = default; return false; }
        (item, priority) = entries[0];
        int last = entries.Count - 1;
        entries[0] = entries[last];
        entries.RemoveAt(last);
        int parent = 0;
        while (true)
        {
            int left = parent * 2 + 1, right = left + 1, best = parent;
            if (left < entries.Count && Before(left, best)) best = left;
            if (right < entries.Count && Before(right, best)) best = right;
            if (best == parent) break;
            Swap(parent, best);
            parent = best;
        }
        return true;
    }
}

public sealed class Graph<TNode> where TNode : IEquatable<TNode>
{
    private readonly Dictionary<TNode, List<(TNode To, int Cost)>> edges = new Dictionary<TNode, List<(TNode, int)>>();

    public Graph<TNode> Connect(TNode from, TNode to, int cost, bool bothWays = true)
    {
        Neighbours(from).Add((to, cost));
        if (bothWays) Neighbours(to).Add((from, cost)); else Neighbours(to);
        return this;
    }

    private List<(TNode To, int Cost)> Neighbours(TNode node)
    {
        if (!edges.TryGetValue(node, out var list)) edges[node] = list = new List<(TNode, int)>();
        return list;
    }

    public IEnumerable<TNode> Nodes => edges.Keys;

    public (int Cost, List<TNode> Path)? ShortestPath(TNode start, TNode goal)
    {
        var distance = new Dictionary<TNode, int> { [start] = 0 };
        var previous = new Dictionary<TNode, TNode>();
        var queue = new Heap<TNode, int>();
        queue.Push(start, 0);
        while (queue.TryPop(out var node, out int cost))
        {
            if (cost > distance[node]) continue;
            if (node.Equals(goal))
            {
                var path = new List<TNode> { goal };
                while (previous.TryGetValue(path[path.Count - 1], out var step)) path.Add(step);
                path.Reverse();
                return (cost, path);
            }
            foreach (var (to, edgeCost) in edges[node])
            {
                int candidate = cost + edgeCost;
                if (distance.TryGetValue(to, out int known) && known <= candidate) continue;
                distance[to] = candidate;
                previous[to] = node;
                queue.Push(to, candidate);
            }
        }
        return null;
    }

    public IEnumerable<TNode> DepthFirst(TNode start)
    {
        var seen = new HashSet<TNode>();
        var stack = new Stack<TNode>();
        stack.Push(start);
        while (stack.Count > 0)
        {
            var node = stack.Pop();
            if (!seen.Add(node)) continue;
            yield return node;
            foreach (var (to, _) in edges[node].AsEnumerable().Reverse()) stack.Push(to);
        }
    }

    public List<TNode> TopologicalOrder()
    {
        var incoming = edges.Keys.ToDictionary(node => node, _ => 0);
        foreach (var list in edges.Values) foreach (var (to, _) in list) incoming[to]++;
        var ready = new Queue<TNode>(incoming.Where(pair => pair.Value == 0).Select(pair => pair.Key));
        var order = new List<TNode>();
        while (ready.Count > 0)
        {
            var node = ready.Dequeue();
            order.Add(node);
            foreach (var (to, _) in edges[node]) if (--incoming[to] == 0) ready.Enqueue(to);
        }
        return order.Count == edges.Count ? order : null;
    }
}

public static class Program
{
    public static void Main()
    {
        var heap = new Heap<string, double>();
        foreach (var (word, weight) in new[] { ("e", 5.0), ("a", 1.0), ("c", 3.0), ("b", 2.0), ("d", 4.0), ("a2", 1.0) }) heap.Push(word, weight);
        var popped = new List<string>();
        while (heap.TryPop(out var word, out var weight)) popped.Add(word + weight);
        var maxHeap = new Heap<int, int>(descending: true);
        foreach (int n in new[] { 3, 1, 4, 1, 5, 9, 2, 6 }) maxHeap.Push(n, n);
        var top = new List<int>();
        while (top.Count < 3 && maxHeap.TryPop(out int n, out _)) top.Add(n);
        Console.WriteLine(string.Join(" ", popped) + " | " + string.Join("", top) + " left " + maxHeap.Count + " " + heap.TryPop(out _, out _));

        var map = new Graph<string>()
            .Connect("A", "B", 7).Connect("A", "C", 9).Connect("A", "F", 14).Connect("B", "C", 10).Connect("B", "D", 15)
            .Connect("C", "D", 11).Connect("C", "F", 2).Connect("D", "E", 6).Connect("E", "F", 9).Connect("X", "Y", 1);
        foreach (var goal in new[] { "E", "D", "A", "Y" })
        {
            var result = map.ShortestPath("A", goal);
            Console.WriteLine(goal + ": " + (result is var (cost, path) ? cost + " via " + string.Join(">", path) : "unreachable"));
        }
        Console.WriteLine(string.Join("", map.DepthFirst("A")) + " " + string.Join("", map.DepthFirst("X")) + " " + map.Nodes.Count() + " " + (map.TopologicalOrder() == null));
        var tasks = new Graph<int>().Connect(1, 2, 0, false).Connect(1, 3, 0, false).Connect(3, 2, 0, false).Connect(2, 4, 0, false).Connect(5, 4, 0, false);
        Console.WriteLine(string.Join(",", tasks.TopologicalOrder()) + " " + tasks.ShortestPath(1, 4)?.Path.Count + " " + (tasks.ShortestPath(4, 1) == null));
        var points = new Graph<(int X, int Y)>().Connect((0, 0), (0, 1), 1).Connect((0, 1), (1, 1), 1).Connect((0, 0), (1, 1), 5);
        Console.WriteLine(string.Join("", points.ShortestPath((0, 0), (1, 1)).Value.Path));
    }
}
