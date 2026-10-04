using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

public sealed class Counter
{
    private int value;
    public Func<int> Increment => () => ++value;
    public Action<int> Add => amount => value += amount;
    public Func<Func<int>> Snapshot => () => { int captured = value; return () => captured; };
}

public static class Program
{
    private static Func<int, int> Compose(params Func<int, int>[] functions)
    {
        Func<int, int> result = x => x;
        foreach (var function in functions)
        {
            var previous = result;
            result = x => function(previous(x));
        }
        return result;
    }

    private static Func<T, TResult> Memoize<T, TResult>(Func<T, TResult> function, List<T> misses)
    {
        var cache = new Dictionary<T, TResult>();
        return argument =>
        {
            if (!cache.TryGetValue(argument, out var result))
            {
                misses.Add(argument);
                cache[argument] = result = function(argument);
            }
            return result;
        };
    }

    private static IEnumerable<Func<int>> Generators(int count)
    {
        int shared = 0;
        for (int i = 0; i < count; i++)
        {
            int own = i * 10;
            int Next() => own + ++shared;
            yield return Next;
            yield return () => own-- - shared;
        }
    }

    private static async Task<int> SumAsync(IEnumerable<int> values)
    {
        int total = 0;
        async Task AddAsync(int value)
        {
            await Task.Yield();
            total += value;
        }
        foreach (var value in values)
        {
            await AddAsync(value);
            Func<Task<int>> twice = async () => { await Task.Delay(1); return value * 2; };
            total += await twice();
        }
        return total;
    }

    private static Func<int, Func<int, Func<int, int>>> Curry(Func<int, int, int, int> function) => a => b => c => function(a, b, c);

    public static async Task Main()
    {
        var forActions = new List<Func<int>>();
        for (int i = 0; i < 3; i++) forActions.Add(() => i);
        var foreachActions = new List<Func<int>>();
        foreach (var i in Enumerable.Range(0, 3)) foreachActions.Add(() => i);
        var whileActions = new List<Func<int>>();
        int w = 0;
        while (w < 3)
        {
            int copy = w++;
            whileActions.Add(() => copy * 10 + w);
        }
        Console.WriteLine(string.Join("", forActions.Select(f => f())) + " " + string.Join("", foreachActions.Select(f => f())) + " " + string.Join(",", whileActions.Select(f => f())));

        var counter = new Counter();
        var increment = counter.Increment;
        increment(); increment();
        var snapshot = counter.Snapshot();
        counter.Add(10);
        Console.WriteLine(increment() + " " + snapshot() + " " + counter.Snapshot()());

        Console.WriteLine(Compose(x => x + 1, x => x * 2, x => x - 3)(5) + " " + Compose()(7) + " " + Curry((a, b, c) => a * 100 + b * 10 + c)(1)(2)(3));

        var misses = new List<int>();
        Func<int, long> fibonacci = null;
        fibonacci = Memoize<int, long>(n => n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2), misses);
        Console.WriteLine(fibonacci(50) + " " + misses.Count + " " + fibonacci(10) + " " + misses.Count);

        var generated = Generators(2).ToList();
        Console.WriteLine(string.Join(" ", generated.Select(g => g())) + " | " + string.Join(" ", generated.Select(g => g())));

        Console.WriteLine(await SumAsync(new[] { 1, 2, 3 }));

        int outer = 1;
        Func<int> nested = () =>
        {
            int middle = outer * 2;
            Func<int> inner = () =>
            {
                int local = middle + outer;
                outer += local;
                return local;
            };
            return inner() + inner();
        };
        Console.WriteLine(nested() + " " + outer + " " + nested() + " " + outer);

        var table = new Dictionary<string, Func<double, double, double>>
        {
            ["add"] = (l, r) => l + r,
            ["sub"] = (l, r) => l - r,
            ["pow"] = Math.Pow,
            ["max"] = Math.Max,
        };
        double accumulator = 2;
        foreach (var name in new[] { "add", "pow", "sub", "max" }) accumulator = table[name](accumulator, 3);
        Console.WriteLine(accumulator);

        Action chain = null;
        var order = new List<string>();
        for (int i = 0; i < 3; i++)
        {
            int index = i;
            chain += () => order.Add("a" + index);
            if (i == 1) chain += () => order.Add("extra" + i);
        }
        chain();
        Console.WriteLine(string.Join(",", order) + " " + chain.GetInvocationList().Length);

        int depthReached = 0;
        void Recurse(int depth, Action<int> visit)
        {
            if (depth == 0) return;
            visit(depth);
            Recurse(depth - 1, d => { visit(d); depthReached += d; });
        }
        int visits = 0;
        Recurse(4, _ => visits++);
        Console.WriteLine(visits + " " + depthReached);

        static int Square(int n) => n * n;
        Func<int, int> square = Square;
        Converter<int, string> text = n => "<" + n + ">";
        Predicate<int> even = n => n % 2 == 0;
        Console.WriteLine(string.Join("", Array.ConvertAll(Array.FindAll(new[] { 1, 2, 3, 4 }, even), text)) + square(square(3)) + new List<int> { 5, 6, 7 }.FindIndex(even));
    }
}
