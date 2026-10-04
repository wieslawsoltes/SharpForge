using System;
using System.Collections.Generic;
using System.Threading.Tasks;
public delegate ref int Selector(int[] items);
public sealed class Handlers
{
    public Func<int, int> Step { get; set; }
    public Dictionary<string, Func<int, int>> Named { get; } = new Dictionary<string, Func<int, int>>();
    public Func<int, int> this[int index] { get => null; set => Step = value; }
}
public static class Program
{
    static async Task<int> CountAsync(IEnumerable<int> source, Func<int, ValueTask<bool>> predicate)
    {
        int count = 0;
        foreach (var item in source) if (await predicate(item)) count++;
        return count;
    }
    public static async Task Main()
    {
        var table = new Dictionary<string, Func<double, double, double>>
        {
            ["add"] = (l, r) => l + r,
            ["pow"] = Math.Pow,
        };
        var handlers = new Handlers { Step = x => x + 1, Named = { ["twice"] = x => x * 2 }, [0] = x => x - 1 };
        Console.WriteLine(table["add"](2, 3) + " " + table["pow"](2, 3) + " " + handlers.Step(5) + " " + handlers.Named["twice"](5));
        bool twice = true;
        Func<int, int> doubled = x => x * 2, chosen = twice ? doubled : x => x;
        Func<int, int> other = !twice ? doubled : x => x + 100;
        Console.WriteLine(chosen(4) + " " + other(4));
        Selector last = items => ref items[items.Length - 1];
        int[] data = { 1, 2, 3 };
        last(data) = 30;
        last(data)++;
        last(data) += 5;
        Console.WriteLine(string.Join(",", data));
        ref int First(int[] items) => ref items[0];
        First(data) = -1;
        First(data) *= 3;
        Func<Func<int, int>[]> many = () => new Func<int, int>[] { x => x + 1, x => x * x };
        var tuple = (Name: "sq", Apply: (Func<int, int>)(x => x * x));
        Console.WriteLine(string.Join(",", data) + " " + many()[1](5) + " " + tuple.Apply(6));
        Console.WriteLine(await CountAsync(new[] { 1, 2, 3, 4 }, async n => { await Task.Yield(); return n % 2 == 0; }));
        Func<int, ValueTask<int>> square = async n => { await Task.Yield(); return n * n; };
        Func<ValueTask> nothing = async () => { await Task.Yield(); };
        await nothing();
        Console.WriteLine(await square(7));
    }
}
