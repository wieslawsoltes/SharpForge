using System;
using System.Collections.Generic;

public sealed class Resource : IDisposable
{
    private readonly List<string> log;
    public string Name { get; }
    public bool IsOpen { get; private set; } = true;
    public Resource(string name, List<string> log) { Name = name; this.log = log; log.Add("open " + name); }
    public void Dispose() { IsOpen = false; log.Add("close " + Name); }
}

public struct Marker : IDisposable
{
    public static int Disposed;
    public int Id;
    public void Dispose() { Disposed += Id; }
}

public static class Program
{
    private static string Scoped(List<string> log)
    {
        // A using declaration and a using statement whose variables are captured by lambdas.
        using var first = new Resource("first", log);
        Func<string> state = () => first.Name + ":" + first.IsOpen;
        using (Resource second = new Resource("second", log), third = new Resource("third", log))
        {
            Func<string> both = () => second.Name + "+" + third.Name + ":" + third.IsOpen;
            log.Add(both());
        }
        using (var marker = new Marker { Id = 5 })
        {
            Func<int> id = () => marker.Id;
            log.Add("marker " + id());
        }
        return state();
    }

    public static void Main()
    {
        var log = new List<string>();
        Console.WriteLine(Scoped(log));
        Console.WriteLine(string.Join(", ", log));
        Console.WriteLine(Marker.Disposed);

        using var outer = new Resource("outer", log);
        Action<string> note = text => log.Add(text + " " + outer.IsOpen);
        for (int round = 0; round < 2; round++)
        {
            using var inner = new Resource("inner" + round, log);
            Func<bool> open = () => inner.IsOpen && outer.IsOpen;
            note("round " + round + " " + open());
        }
        Console.WriteLine(string.Join(", ", log.GetRange(8, log.Count - 8)));
    }
}
