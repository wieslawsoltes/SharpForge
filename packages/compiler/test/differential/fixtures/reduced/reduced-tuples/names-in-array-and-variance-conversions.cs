using System;
using System.Collections.Generic;
using System.Linq;

// Reduced from stress-collections/graph-search-priority-queue: element names are not part of a tuple's identity, so
// an array or sequence of unnamed tuples converts to a collection interface over the named tuple type (and back).
public static class Program
{
    private static int Total(IEnumerable<(string Element, int Priority)> items) => items.Sum(item => item.Priority);

    private static string Names(IReadOnlyList<(string Name, int Rank)> items) => string.Join(",", items.Select(item => item.Name));

    private static (string, int)[] Plain((string Label, int Weight)[] items) => items;

    public static void Main()
    {
        var queue = new PriorityQueue<string, int>();
        queue.EnqueueRange(new[] { ("refactor", 5), ("review", 2) });
        (string Task, int Cost)[] named = { ("deploy", 9), ("test", 1) };
        queue.EnqueueRange(named);
        List<(string, int)> list = new List<(string, int)> { ("a", 1), ("b", 2) };
        IEnumerable<(string Key, int Value)> renamed = list;
        Console.WriteLine(queue.Count + " " + queue.Dequeue() + " " + Total(new[] { ("x", 3), ("y", 4) }) + " " + Total(named) + " " + Total(list));
        Console.WriteLine(Names(named) + " " + Names(list) + " " + Plain(named).Length + " " + renamed.First().Key);
    }
}
