using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

// Reduced from stress-operators/config-graph-initializers: a spread in a collection expression whose target has no
// `AddRange` (HashSet, a source collection) adds the items one by one; and `with` on an anonymous type.
public sealed record Route(string Verb, string Path, int Weight);

public sealed class RouteTable : IEnumerable<Route>
{
    private readonly List<Route> routes = new List<Route>();
    public int Adds;
    public void Add(Route route) { Adds++; routes.Add(route); }
    public IEnumerator<Route> GetEnumerator() => routes.GetEnumerator();
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

public static class Program
{
    private static IEnumerable<int> Evens()
    {
        yield return 2;
        yield return 4;
    }

    public static void Main()
    {
        int[] more = { 1, 2, 3 };
        HashSet<int> set = [1, 1, ..more, ..Evens(), 9];
        SortedSet<string> names = ["b", .. new[] { "c", "a" }];
        var routes = new List<Route> { new("GET", "/a", 1), new("POST", "/b", 3) };
        RouteTable table = [new Route("HEAD", "/x", 1), .. routes.Where(route => route.Weight > 1), new Route("GET", "/y", 2)];
        Console.WriteLine(string.Join(",", set.OrderBy(n => n)) + " " + string.Join(",", names) + " " + table.Adds + " " + string.Join(" ", table.Select(r => r.Path)));

        var anonymous = new { Name = "edge", Ports = new[] { 80, 443 }, Inner = new { Depth = 1, Label = "x" } };
        var changed = anonymous with { Name = "core", Inner = anonymous.Inner with { Depth = 2 } };
        var same = anonymous with { };
        Console.WriteLine(anonymous + " | " + changed.Name + " " + changed.Inner + " " + ReferenceEquals(changed.Ports, anonymous.Ports));
        Console.WriteLine(same.Equals(anonymous) + " " + ReferenceEquals(same, anonymous) + " " + (changed with { Name = "edge" }).Name);
    }
}
