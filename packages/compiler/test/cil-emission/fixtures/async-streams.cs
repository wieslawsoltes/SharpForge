using System;
using System.Collections.Generic;
using System.Threading.Tasks;

class Resource : IAsyncDisposable
{
    readonly string name;
    public Resource(string name) { this.name = name; Console.WriteLine("open " + name); }
    public async ValueTask DisposeAsync() { await Task.Delay(1); Console.WriteLine("close " + name); }
}

class Countdown
{
    readonly int from;
    public Countdown(int from) { this.from = from; }
    public Ticker GetAsyncEnumerator() { return new Ticker(from); }
}

class Ticker
{
    int next;
    public Ticker(int from) { next = from + 1; }
    public int Current { get { return next; } }
    public async Task<bool> MoveNextAsync() { await Task.Yield(); next--; return next > 0; }
    public async Task DisposeAsync() { await Task.Delay(1); Console.WriteLine("ticker disposed"); }
}

class Source<T>
{
    readonly T[] items;
    public Source(params T[] items) { this.items = items; }
    public async IAsyncEnumerable<T> Slowly()
    {
        foreach (T item in items)
        {
            await Task.Delay(1);
            yield return item;
        }
    }
}

class Program
{
    static async IAsyncEnumerable<int> Numbers(int count)
    {
        Console.WriteLine("numbers start");
        try
        {
            for (int i = 1; i <= count; i++)
            {
                await Task.Delay(1);
                yield return i;
            }
        }
        finally
        {
            await Task.Yield();
            Console.WriteLine("numbers finally");
        }
    }

    static async IAsyncEnumerable<string> Words()
    {
        yield return "a";
        await Task.Delay(1);
        yield return "b";
        await foreach (int n in Numbers(2)) yield return "n" + n;
        yield return "c" + await Task.FromResult(3);
    }

    static async IAsyncEnumerable<T> Pairs<T>(T first, T second, bool stopEarly)
    {
        yield return first;
        if (stopEarly) yield break;
        await Task.Yield();
        yield return second;
    }

    static async IAsyncEnumerator<int> Squares(int count)
    {
        for (int i = 1; i <= count; i++)
        {
            await Task.Yield();
            yield return i * i;
        }
    }

    static async IAsyncEnumerable<int> Fails()
    {
        yield return 1;
        await Task.Delay(1);
        throw new InvalidOperationException("stream failed");
    }

    static async Task Main()
    {
        Func<int, int> twice = x => x * 2;
        await foreach (int n in Numbers(3)) Console.WriteLine(twice(n));
        Console.WriteLine("--- early break");
        await foreach (int n in Numbers(5)) { Console.WriteLine(n); if (n == 2) break; }
        Console.WriteLine("--- nested");
        await foreach (string w in Words()) Console.WriteLine(w);

        Console.WriteLine("--- manual");
        IAsyncEnumerable<int> numbers = Numbers(2);
        IAsyncEnumerator<int> e = numbers.GetAsyncEnumerator();
        Console.WriteLine("same object: " + ReferenceEquals(numbers, e) + " " + ReferenceEquals(e, numbers.GetAsyncEnumerator()));
        Console.WriteLine(await e.MoveNextAsync() + " " + e.Current);
        await e.DisposeAsync();
        Console.WriteLine(await e.MoveNextAsync());
        IAsyncEnumerator<int> unstarted = Numbers(2).GetAsyncEnumerator();
        await unstarted.DisposeAsync();
        Console.WriteLine("unstarted disposed: " + await unstarted.MoveNextAsync());

        Console.WriteLine("--- generic, enumerator, pattern");
        await foreach (string item in new Source<string>("x", "y").Slowly()) Console.WriteLine(item);
        await foreach (double value in Pairs(1.5, 2.5, false)) Console.WriteLine(value > 2);
        await foreach (string value in Pairs("only", "never", true)) Console.WriteLine(value);
        IAsyncEnumerator<int> squares = Squares(3);
        int sum = 0;
        while (await squares.MoveNextAsync()) sum += squares.Current;
        Console.WriteLine(sum);
        await foreach (int tick in new Countdown(3)) Console.WriteLine("tick " + tick);

        Console.WriteLine("--- failure");
        try
        {
            await foreach (int n in Fails()) Console.WriteLine(n);
        }
        catch (InvalidOperationException error)
        {
            Console.WriteLine("caught " + error.Message);
        }

        Console.WriteLine("--- await using");
        await using (Resource outer = new Resource("outer"))
        {
            await using var inner = new Resource("inner");
            Console.WriteLine("body");
        }
        Console.WriteLine("done");
    }
}
