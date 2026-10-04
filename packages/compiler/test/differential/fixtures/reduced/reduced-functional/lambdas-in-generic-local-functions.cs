using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

public class Registry<TKey>
{
    private readonly Dictionary<TKey, string> names = new Dictionary<TKey, string>();
    private int version;

    // A generic local function inside a method of a generic type: its lambdas see TKey, TValue and `this`.
    public string Register<TSource>(IEnumerable<TSource> sources, Func<TSource, TKey> keyOf)
    {
        int added = 0;
        string Describe<TValue>(TKey key, TValue value)
        {
            Func<TValue, string> render = v => key + "=" + v + "#" + (++version);
            Func<string> counted = () => render(value) + "/" + (++added);
            return counted();
        }
        foreach (TSource source in sources) names[keyOf(source)] = Describe(keyOf(source), source);
        return string.Join(" ", names.Values) + " added=" + added;
    }
}

public static class Program
{
    private static T Run<T>(Func<T> body)
    {
        T result = default;
        Action invoke = () => result = body();
        invoke();
        return result;
    }

    public static async Task Main()
    {
        // A lambda that captures a local of the generic local function's type parameter.
        static T Twice<T>(T seed, Func<T, T> step)
        {
            T Once(T value) => step(value);
            Func<T, T> both = value => Once(Once(value));
            return both(seed);
        }
        Console.WriteLine(Twice(4, x => x + 1) + " " + Twice("a", s => s + "b") + " " + Run(() => 2.5) + " " + Run(() => "text"));

        // Two levels of generic local functions; the innermost lambda uses the type parameters of both.
        List<TItem> Collect<TItem>(int count, Func<int, TItem> make)
        {
            var list = new List<TItem>();
            void Add<TOther>(TOther extra, Func<TOther, TItem> convert)
            {
                Action<TItem> push = item => list.Add(item);
                Func<TOther, KeyValuePair<TOther, TItem>> pair = other => new KeyValuePair<TOther, TItem>(other, convert(other));
                push(pair(extra).Value);
            }
            for (int i = 0; i < count; i++) { int copy = i; Add(copy, n => make(n + copy)); Add("s" + i, s => make(s.Length)); }
            return list;
        }
        Console.WriteLine(string.Join(",", Collect(3, i => "v" + i)) + " | " + string.Join(",", Collect(2, i => i * 1.5)));

        // An iterator and an async lambda inside generic local functions.
        IEnumerable<TOut> Map<TIn, TOut>(IEnumerable<TIn> items, Func<TIn, TOut> map)
        {
            IEnumerable<TOut> Walk()
            {
                foreach (TIn item in items) yield return map(item);
            }
            return Walk().Where(item => item != null);
        }
        async Task<T[]> AllAsync<T>(params T[] values)
        {
            Func<T, Task<T>> later = async value => { await Task.Yield(); return value; };
            var results = new List<T>();
            foreach (T value in values) results.Add(await later(value));
            return results.ToArray();
        }
        Console.WriteLine(string.Join(";", Map(new[] { 1, 2, 3 }, n => new string('*', n))) + " " + string.Join("+", await AllAsync(1, 2, 3)) + " " + (await AllAsync("x", "y")).Length);

        var registry = new Registry<int>();
        Console.WriteLine(registry.Register(new[] { "one", "three" }, text => text.Length));
        Console.WriteLine(registry.Register(new[] { 2.5, 7.25 }, number => (int)number));
    }
}
