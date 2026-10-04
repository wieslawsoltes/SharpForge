using System;
using System.Collections.Generic;
using System.Linq;

public static class Functional
{
    public static Func<TA, TC> Then<TA, TB, TC>(this Func<TA, TB> first, Func<TB, TC> second) => value => second(first(value));
    public static Func<TB, TC> Partial<TA, TB, TC>(this Func<TA, TB, TC> function, TA first) => second => function(first, second);
    public static Func<TA, Func<TB, TC>> Curry<TA, TB, TC>(this Func<TA, TB, TC> function) => a => b => function(a, b);
    public static Func<TB, TA, TC> Flip<TA, TB, TC>(this Func<TA, TB, TC> function) => (b, a) => function(a, b);
    public static Action<T> Tee<T>(this Action<T> first, Action<T> second) => value => { first(value); second(value); };
    public static Predicate<T> Not<T>(this Predicate<T> predicate) => value => !predicate(value);
    public static Func<T, bool> And<T>(this Func<T, bool> left, Func<T, bool> right) => value => left(value) && right(value);
    public static Func<T, bool> Or<T>(this Func<T, bool> left, Func<T, bool> right) => value => left(value) || right(value);
    public static T Pipe<T>(this T value, params Func<T, T>[] steps)
    {
        foreach (var step in steps) value = step(value);
        return value;
    }
    public static TResult Let<T, TResult>(this T value, Func<T, TResult> body) => body(value);
    public static T Also<T>(this T value, Action<T> effect) { effect(value); return value; }
    public static Func<T> Lazy<T>(Func<T> factory)
    {
        bool evaluated = false;
        T cached = default;
        return () =>
        {
            if (!evaluated) { cached = factory(); evaluated = true; }
            return cached;
        };
    }
    public static IEnumerable<TState> Unfold<TState>(TState seed, Func<TState, bool> proceed, Func<TState, TState> next)
    {
        for (var state = seed; proceed(state); state = next(state)) yield return state;
    }
    public static TAccumulate FoldRight<T, TAccumulate>(this IReadOnlyList<T> items, TAccumulate seed, Func<T, TAccumulate, TAccumulate> folder)
    {
        for (int i = items.Count - 1; i >= 0; i--) seed = folder(items[i], seed);
        return seed;
    }
}

public sealed class Middleware
{
    private readonly List<Func<Func<string, string>, Func<string, string>>> layers = new List<Func<Func<string, string>, Func<string, string>>>();
    public Middleware Use(Func<Func<string, string>, Func<string, string>> layer) { layers.Add(layer); return this; }
    public Middleware Use(Func<string, string> before) => Use(next => request => next(before(request)));
    public Func<string, string> Build(Func<string, string> terminal)
    {
        var pipeline = terminal;
        for (int i = layers.Count - 1; i >= 0; i--) pipeline = layers[i](pipeline);
        return pipeline;
    }
}

public static class Program
{
    public static void Main()
    {
        Func<int, int> increment = x => x + 1;
        Func<int, string> describe = x => "<" + x + ">";
        Func<string, int> length = s => s.Length;
        var composed = increment.Then(describe).Then(length).Then(increment);
        Func<int, int, int> power = (b, e) => (int)Math.Pow(b, e);
        var twoTo = power.Partial(2);
        var squared = power.Flip().Partial(2);
        Console.WriteLine(composed(99) + " " + twoTo(10) + " " + squared(9) + " " + power.Curry()(3)(4) + " " + 5.Pipe(increment, x => x * x, increment) + " " + "abc".Pipe() + " " + 7.Let(x => x * 6).Let(describe));

        var seen = new List<string>();
        Action<int> record = x => seen.Add("r" + x);
        var both = record.Tee(x => seen.Add("s" + x * 2)).Tee(record);
        both(4);
        var list = new List<int> { 1, 2, 3 }.Also(l => l.Add(4)).Also(l => l.Reverse());
        Predicate<int> even = x => x % 2 == 0;
        Func<int, bool> small = x => x < 3, big = x => x > 8;
        Console.WriteLine(string.Join(",", seen) + " " + string.Join("", list) + " " + string.Join("", list.FindAll(even.Not())) + " " + string.Join("", Enumerable.Range(0, 12).Where(small.Or(big).And(x => x != 9))));

        int evaluations = 0;
        var lazy = Functional.Lazy(() => { evaluations++; return new string('x', 3); });
        Console.WriteLine(evaluations + lazy() + lazy() + evaluations);
        Console.WriteLine(string.Join(" ", Functional.Unfold((A: 0, B: 1), s => s.A < 60, s => (s.B, s.A + s.B)).Select(s => s.A)) + " | " + string.Join(" ", Functional.Unfold(1.0, v => v > 0.1, v => v / 2)) + " | " + string.Join("", Functional.Unfold("a", s => s.Length < 4, s => s + (char)(s[s.Length - 1] + 1))));
        var digits = new[] { 1, 2, 3, 4 };
        Console.WriteLine(digits.Aggregate("", (text, d) => "(" + text + d + ")") + " " + digits.FoldRight("", (d, text) => "(" + d + text + ")") + " " + digits.FoldRight(0, (d, sum) => sum * 10 + d) + " " + digits.Aggregate(new List<int>(), (acc, d) => { acc.Insert(0, d); return acc; }, acc => string.Join("", acc)));

        var trace = new List<string>();
        var app = new Middleware()
            .Use(next => request => { trace.Add("log>" + request); var response = next(request); trace.Add("log<" + response); return response; })
            .Use(request => request.Trim())
            .Use(next => request => request.Length == 0 ? "400 empty" : next(request))
            .Use(next => request => "[" + next(request.ToUpperInvariant()) + "]")
            .Build(request => "200 " + request);
        Console.WriteLine(app("  hello ") + " " + app("   ") + " | " + string.Join(" ", trace));

        Func<Func<int, int>, Func<int, int>> twice = f => x => f(f(x));
        Func<int, Func<int, int>> adder = n => x => x + n;
        Func<int, int> fix(Func<Func<int, int>, Func<int, int>> generator) => x => generator(fix(generator))(x);
        var factorial = fix(self => n => n <= 1 ? 1 : n * self(n - 1));
        var operations = new (string Name, Func<double, double> Apply)[] { ("half", v => v / 2), ("neg", v => -v), ("sq", v => v * v) };
        Console.WriteLine(twice(twice(adder(3)))(0) + " " + twice(twice(increment))(0) + " " + factorial(10) + " " + string.Join(" ", operations.Select(op => op.Name + "=" + op.Apply(6))) + " " + operations.Aggregate(3.0, (v, op) => op.Apply(v)));
    }
}
