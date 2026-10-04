using System;
using System.Collections.Generic;

public ref struct Window
{
    public readonly ref int First;
    public ref readonly int Last;
    public Window(Span<int> span) { First = ref span[0]; Last = ref span[^1]; }
    public readonly int Sum => First + Last;
}

public static class Refs
{
    // The iteration variable of a ref foreach over a span escapes like the span: it can be returned by reference.
    public static ref readonly T FirstMatch<T>(ReadOnlySpan<T> span, Predicate<T> match, in T fallback)
    {
        foreach (ref readonly T item in span)
            if (match(item)) return ref item;
        return ref fallback;
    }

    public static ref int FirstNegative(Span<int> span, ref int none)
    {
        foreach (ref int item in span)
        {
            if (item < 0) return ref item;
        }
        return ref none;
    }

    // `return ref` out of try blocks: the address leaves the protected regions through a by-reference temporary.
    public static ref int Guarded(int[] values, int index, List<string> log)
    {
        try
        {
            try
            {
                if (index < 0) return ref values[^(-index)];
                return ref values[index];
            }
            finally { log.Add("inner " + index); }
        }
        finally { log.Add("outer " + index); }
    }

    // An element taken from the end is an element: on the heap for an array, as wide as the span for a span.
    public static ref int LastOf(int[] values) => ref values[^1];
    public static ref int LastOf(Span<int> values) => ref values[^1];
}

public static class Program
{
    public static void Main()
    {
        int[] numbers = { 5, -3, 9, 1, 7 };
        ref int cursor = ref numbers[0];
        cursor++;
        cursor = ref numbers[^1];
        cursor *= 2;
        cursor = ref numbers.AsSpan()[^2];
        cursor += 100;
        Console.WriteLine(string.Join(",", numbers));

        int none = 0;
        Refs.FirstNegative(numbers, ref none) = 33;
        Refs.FirstNegative(numbers, ref none) = 44;
        Refs.LastOf(numbers)++;
        Refs.LastOf(numbers.AsSpan(0, 2)) += 1000;
        Console.WriteLine(string.Join(",", numbers) + " none=" + none);

        string[] words = { "pear", "fig", "apple" };
        ref readonly string five = ref Refs.FirstMatch<string>(words, w => w.Length == 5, "none");
        Console.WriteLine(five + " " + Refs.FirstMatch<string>(words, w => w.Length == 7, "none") + " " + object.ReferenceEquals(five, words[2]));

        var log = new List<string>();
        Refs.Guarded(numbers, 1, log) = -1;
        Refs.Guarded(numbers, -1, log) += 5;
        Console.WriteLine(string.Join(",", numbers) + " | " + string.Join("; ", log));

        var window = new Window(numbers);
        window.First = 70;
        window.Last = ref numbers[1];
        Console.WriteLine(window.Sum + " " + numbers[0]);
    }
}
