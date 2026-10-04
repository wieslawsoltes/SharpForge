using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    private static IEnumerable<string> Tokens(string text)
    {
        if (text == null) throw new ArgumentNullException(nameof(text));
        return Core();

        IEnumerable<string> Core()
        {
            int start = 0;
            bool Separator(char c) => c == ' ' || c == ',';
            for (int i = 0; i <= text.Length; i++)
            {
                if (i < text.Length && !Separator(text[i])) continue;
                if (i > start) yield return Slice(start, i);
                start = i + 1;
            }
        }

        string Slice(int from, int to) => text.Substring(from, to - from);
    }

    private static IEnumerable<int> Flatten(object tree)
    {
        int depth = 0, maxDepth = 0;
        foreach (int leaf in Visit(tree)) yield return leaf;
        yield return -maxDepth;

        IEnumerable<int> Visit(object node)
        {
            depth++;
            maxDepth = Math.Max(maxDepth, depth);
            if (node is int value) yield return value * depth;
            else if (node is object[] children)
                foreach (object child in children)
                    foreach (int leaf in Visit(child))
                        yield return leaf;
            depth--;
        }
    }

    private static IEnumerable<(int Index, T Item)> Numbered<T>(IEnumerable<T> source, Func<T, bool> skip = null)
    {
        int index = 0;
        bool Keep(T item) => skip == null || !skip(item);
        (int, T) Next(T item) => (index++, item);
        foreach (var item in source)
            if (Keep(item)) yield return Next(item);
    }

    private static IEnumerable<IEnumerable<T>> Combinations<T>(IReadOnlyList<T> items, int size)
    {
        var chosen = new List<T>();
        return Choose(0);

        IEnumerable<IEnumerable<T>> Choose(int from)
        {
            if (chosen.Count == size)
            {
                yield return chosen.ToArray();
                yield break;
            }
            for (int i = from; i <= items.Count - (size - chosen.Count); i++)
            {
                chosen.Add(items[i]);
                foreach (var combination in Choose(i + 1)) yield return combination;
                chosen.RemoveAt(chosen.Count - 1);
            }
        }
    }

    private static int Ackermann(int m, int n)
    {
        int calls = 0;
        int result = Compute(m, n);
        return result * 1000 + calls % 1000;

        int Compute(int a, int b)
        {
            calls++;
            return a == 0 ? b + 1 : b == 0 ? Compute(a - 1, 1) : Compute(a - 1, Compute(a, b - 1));
        }
    }

    private static Func<int> MakeCounter(int start, out Action reset)
    {
        int current = start;
        int Next() => current++;
        void Reset() => current = start;
        reset = Reset;
        return Next;
    }

    private static string Hanoi(int disks)
    {
        var moves = new List<string>();
        Move(disks, 'A', 'C', 'B');
        return moves.Count + ":" + string.Join(" ", moves.Take(7));

        void Move(int n, char from, char to, char via)
        {
            if (n == 0) return;
            Move(n - 1, from, via, to);
            moves.Add($"{from}{to}");
            Move(n - 1, via, to, from);
        }
    }

    private static IEnumerable<int> Merge(IEnumerable<int> left, IEnumerable<int> right)
    {
        using var a = left.GetEnumerator();
        using var b = right.GetEnumerator();
        bool hasA = a.MoveNext(), hasB = b.MoveNext();
        while (hasA || hasB)
        {
            if (!hasB || (hasA && a.Current <= b.Current)) { yield return Take(a, ref hasA); }
            else { yield return Take(b, ref hasB); }
        }

        static int Take(IEnumerator<int> source, ref bool has)
        {
            int value = source.Current;
            has = source.MoveNext();
            return value;
        }
    }

    public static void Main()
    {
        Console.WriteLine(string.Join("|", Tokens("alpha, beta  gamma,,delta ")) + " " + Tokens("").Count());
        try { Tokens(null); Console.WriteLine("lazy"); } catch (ArgumentNullException e) { Console.WriteLine("eager check: " + e.ParamName); }
        object tree = new object[] { 1, new object[] { 2, new object[] { 3, 4 }, 5 }, new object[0], 6 };
        Console.WriteLine(string.Join(",", Flatten(tree)) + " " + string.Join(",", Flatten(7)));
        Console.WriteLine(string.Join(" ", Numbered("abcdef", c => c == 'c' || c == 'e').Select(pair => pair.Index + "" + pair.Item)) + " " + string.Join("", Numbered(new[] { 1.5, 2.5 }).Select(pair => pair.Item + pair.Index)));
        Console.WriteLine(string.Join(" ", Combinations(new[] { "a", "b", "c", "d" }, 2).Select(c => string.Concat(c))) + " " + Combinations(Enumerable.Range(1, 6).ToList(), 3).Count() + " " + Combinations(new int[0], 0).Count() + " " + Combinations(new[] { 1 }, 2).Count());
        Console.WriteLine(Ackermann(2, 3) + " " + Ackermann(0, 0) + " " + Hanoi(3) + " " + Hanoi(10).Split(':')[0]);
        var next = MakeCounter(5, out var reset);
        string before = "" + next() + next() + next();
        reset();
        Console.WriteLine(before + " " + next() + next());
        Console.WriteLine(string.Join(",", Merge(new[] { 1, 4, 9 }, new[] { 2, 3, 10, 11 })) + " " + string.Join(",", Merge(Enumerable.Empty<int>(), new[] { 1 })) + " " + Merge(Enumerable.Range(0, 50).Select(x => x * 2), Enumerable.Range(0, 50).Select(x => x * 2 + 1)).SequenceEqual(Enumerable.Range(0, 100)));

        int factor = 3;
        int Scale(int value) => value * factor;
        IEnumerable<int> Scaled(IEnumerable<int> values) { foreach (var value in values) yield return Scale(value); }
        var lazy = Scaled(new[] { 1, 2, 3 });
        factor = 10;
        static T Identity<T>(T value) => value;
        T Twice<T>(T value, Func<T, T> apply) => apply(apply(value));
        Console.WriteLine(string.Join(",", lazy) + " " + Identity("x") + Identity(5) + " " + Twice(2, Scale) + " " + Twice("ab", s => s + s) + " " + Fib(30) + " " + IsEven(10) + IsOdd(7) + IsEven(3));
        int Fib(int n) => n < 2 ? n : Fib(n - 1) + Fib(n - 2);
        bool IsEven(int n) => n == 0 || IsOdd(n - 1);
        bool IsOdd(int n) => n != 0 && IsEven(n - 1);
    }
}
