using System;
using System.Collections.Generic;
using System.Linq;

var graph = new Graph
{
    { "A", "B", 4 }, { "A", "C", 2 }, { "C", "B", 1 }, { "B", "D", 5 }, { "C", "D", 8 }, { "C", "E", 10 },
    { "D", "E", 2 }, { "E", "F", 3 }, { "D", "F", 6 }, { "G", "H", 1 },
};

Console.WriteLine("nodes: " + string.Join(" ", graph.Nodes) + " | edges from C: " + string.Join(" ", graph["C"].Select(e => e.To + e.Cost)));
Console.WriteLine("BFS from A: " + string.Join(" ", graph.BreadthFirst("A").Select(step => step.Node + step.Depth)));
Console.WriteLine("DFS from A: " + string.Join(" ", graph.DepthFirst("A")));
Console.WriteLine("DFS from G: " + string.Join(" ", graph.DepthFirst("G")) + " | components: " + graph.Components());

var (distances, previous, relaxations) = graph.Dijkstra("A");
foreach (string node in graph.Nodes)
{
    if (!distances.TryGetValue(node, out int distance)) { Console.WriteLine($"{node}: unreachable"); continue; }
    var path = new Stack<string>();
    for (string at = node; at != null; at = previous.GetValueOrDefault(at)) path.Push(at);
    Console.WriteLine($"{node}: {distance,2} via {string.Join("-", path)}");
}
Console.WriteLine("relaxations: " + relaxations);

Console.WriteLine("-- PriorityQueue basics");
var queue = new PriorityQueue<string, int>();
queue.Enqueue("write tests", 3);
queue.Enqueue("fix build", 1);
queue.EnqueueRange(new[] { ("refactor", 5), ("review", 2) });
queue.EnqueueRange(new[] { "deploy", "announce" }, 9);
Console.WriteLine(queue.Count + " " + queue.Peek() + " " + queue.TryPeek(out string top, out int topPriority) + ":" + top + "@" + topPriority);
Console.WriteLine(queue.EnqueueDequeue("hotfix", 0) + " " + queue.EnqueueDequeue("lunch", 4) + " " + queue.DequeueEnqueue("triage", 2) + " " + queue.Count);
var drained = new List<string>();
while (queue.TryPeek(out _, out int next) && next < 9 && queue.TryDequeue(out string task, out int priority)) drained.Add(task + "@" + priority);
Console.WriteLine(string.Join(", ", drained) + " | left " + queue.Count + " unordered " + string.Join("+", queue.UnorderedItems.Select(i => i.Element).Order(StringComparer.Ordinal)));
queue.Clear();
Console.WriteLine(queue.TryDequeue(out string nothing, out _) + " " + (nothing ?? "null") + " " + queue.TryPeek(out _, out _));
try { queue.Dequeue(); } catch (InvalidOperationException) { Console.WriteLine("dequeue on empty queue throws"); }

Console.WriteLine("-- custom priority comparers");
var maxHeap = new PriorityQueue<string, int>(Comparer<int>.Create((a, b) => b.CompareTo(a)));
foreach (var (name, score) in new[] { ("ann", 70), ("bob", 95), ("cy", 82), ("di", 88) }) maxHeap.Enqueue(name, score);
Console.WriteLine(string.Join(" ", Drain(maxHeap)));
var tickets = new PriorityQueue<Ticket, Ticket>(new TicketComparer());
int sequence = 0;
foreach (var (severity, title) in new[] { (2, "typo"), (0, "outage"), (2, "slow page"), (1, "bad total"), (0, "data loss"), (2, "alignment") })
{
    var ticket = new Ticket(severity, sequence++, title);
    tickets.Enqueue(ticket, ticket);
}
Console.WriteLine(string.Join(" | ", Drain(tickets).Select(t => $"S{t.Severity}#{t.Sequence} {t.Title}")));
var byTuple = new PriorityQueue<char, (int Length, string Word)>(new[] { "pear", "fig", "apple", "kiwi", "date" }.Select(w => (w[0], (w.Length, w))), Comparer<(int Length, string Word)>.Create((a, b) => a.Length != b.Length ? a.Length - b.Length : string.CompareOrdinal(a.Word, b.Word)));
Console.WriteLine(new string(Drain(byTuple).ToArray()) + " " + byTuple.Count);

Console.WriteLine("-- merge sorted streams and top-k");
int[][] streams = { new[] { 1, 4, 9, 30 }, new[] { 2, 3, 25 }, new int[0], new[] { 5, 6, 7, 8 } };
var heads = new PriorityQueue<(int Stream, int Index), int>();
for (int s = 0; s < streams.Length; s++) if (streams[s].Length > 0) heads.Enqueue((s, 0), streams[s][0]);
var merged = new List<int>();
while (heads.TryDequeue(out var head, out int value))
{
    merged.Add(value);
    if (head.Index + 1 < streams[head.Stream].Length) heads.Enqueue((head.Stream, head.Index + 1), streams[head.Stream][head.Index + 1]);
}
Console.WriteLine(string.Join(" ", merged));
var top3 = new PriorityQueue<int, int>();
foreach (int x in new[] { 15, 3, 99, 42, 7, 64, 8, 77 })
{
    if (top3.Count < 3) top3.Enqueue(x, x);
    else if (x > top3.Peek()) top3.EnqueueDequeue(x, x);
}
Console.WriteLine("top 3 ascending: " + string.Join(" ", Drain(top3)) + " | topological: " + string.Join(" ", graph.TopologicalOrder()));

static IEnumerable<TElement> Drain<TElement, TPriority>(PriorityQueue<TElement, TPriority> source)
{
    while (source.Count > 0) yield return source.Dequeue();
}

public sealed record Ticket(int Severity, int Sequence, string Title);

public sealed class TicketComparer : IComparer<Ticket>
{
    public int Compare(Ticket x, Ticket y) => x.Severity != y.Severity ? x.Severity.CompareTo(y.Severity) : x.Sequence.CompareTo(y.Sequence);
}

public sealed class Graph : IEnumerable<KeyValuePair<string, List<(string To, int Cost)>>>
{
    private readonly SortedDictionary<string, List<(string To, int Cost)>> edges = new SortedDictionary<string, List<(string To, int Cost)>>(StringComparer.Ordinal);
    public IEnumerable<string> Nodes => edges.Keys;
    public IReadOnlyList<(string To, int Cost)> this[string node] => edges[node];

    public void Add(string from, string to, int cost)
    {
        if (!edges.TryGetValue(from, out var list)) edges[from] = list = new List<(string To, int Cost)>();
        list.Add((to, cost));
        edges.TryAdd(to, new List<(string To, int Cost)>());
    }

    public IEnumerable<(string Node, int Depth)> BreadthFirst(string start)
    {
        var seen = new HashSet<string> { start };
        var pending = new Queue<(string Node, int Depth)>();
        pending.Enqueue((start, 0));
        while (pending.TryDequeue(out var current))
        {
            yield return current;
            foreach (var (to, _) in edges[current.Node]) if (seen.Add(to)) pending.Enqueue((to, current.Depth + 1));
        }
    }

    public List<string> DepthFirst(string start)
    {
        var order = new List<string>();
        var seen = new HashSet<string>();
        var stack = new Stack<string>(new[] { start });
        while (stack.TryPop(out string node))
        {
            if (!seen.Add(node)) continue;
            order.Add(node);
            for (int i = edges[node].Count - 1; i >= 0; i--) if (!seen.Contains(edges[node][i].To)) stack.Push(edges[node][i].To);
        }
        return order;
    }

    public int Components()
    {
        var undirected = edges.Keys.ToDictionary(k => k, k => new HashSet<string>());
        foreach (var (from, list) in edges) foreach (var (to, _) in list) { undirected[from].Add(to); undirected[to].Add(from); }
        var seen = new HashSet<string>();
        int count = 0;
        foreach (string node in edges.Keys)
        {
            if (!seen.Add(node)) continue;
            count++;
            var queue = new Queue<string>(new[] { node });
            while (queue.Count > 0) foreach (string next in undirected[queue.Dequeue()]) if (seen.Add(next)) queue.Enqueue(next);
        }
        return count;
    }

    public (Dictionary<string, int> Distances, Dictionary<string, string> Previous, int Relaxations) Dijkstra(string start)
    {
        var distances = new Dictionary<string, int> { [start] = 0 };
        var previous = new Dictionary<string, string>();
        var frontier = new PriorityQueue<string, (int Distance, string Node)>(Comparer<(int Distance, string Node)>.Create((a, b) => a.Distance != b.Distance ? a.Distance.CompareTo(b.Distance) : string.CompareOrdinal(a.Node, b.Node)));
        frontier.Enqueue(start, (0, start));
        int relaxations = 0;
        while (frontier.TryDequeue(out string node, out var priority))
        {
            if (priority.Distance > distances[node]) continue;
            foreach (var (to, cost) in edges[node])
            {
                int candidate = priority.Distance + cost;
                if (distances.TryGetValue(to, out int known) && known <= candidate) continue;
                distances[to] = candidate;
                previous[to] = node;
                relaxations++;
                frontier.Enqueue(to, (candidate, to));
            }
        }
        return (distances, previous, relaxations);
    }

    public IEnumerable<string> TopologicalOrder()
    {
        var incoming = edges.Keys.ToDictionary(k => k, _ => 0);
        foreach (var list in edges.Values) foreach (var (to, _) in list) incoming[to]++;
        var ready = new SortedSet<string>(incoming.Where(p => p.Value == 0).Select(p => p.Key), StringComparer.Ordinal);
        while (ready.Count > 0)
        {
            string node = ready.Min;
            ready.Remove(node);
            yield return node;
            foreach (var (to, _) in edges[node]) if (--incoming[to] == 0) ready.Add(to);
        }
    }

    public IEnumerator<KeyValuePair<string, List<(string To, int Cost)>>> GetEnumerator() => edges.GetEnumerator();
    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
}
