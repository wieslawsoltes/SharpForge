using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;

IEnumerable<long> Naturals(long from = 1)
{
    for (long n = from; ; n++) yield return n;
}

IEnumerable<long> Multiples(long of) => Naturals().Select(n => n * of);

static IEnumerable<long> Collatz(long start)
{
    for (long n = start; n != 1; n = n % 2 == 0 ? n / 2 : 3 * n + 1) yield return n;
    yield return 1;
}

static string Join<T>(IEnumerable<T> items) => string.Join(" ", items);

Console.WriteLine("primes: " + Join(Seq.Primes().Take(15)));
Console.WriteLine("primes 100..130: " + Join(Seq.Primes().SkipWhile(p => p < 100).TakeWhile(p => p < 130)));
Console.WriteLine("twin primes: " + Join(Seq.Primes().Pairwise().Where(pair => pair.Next - pair.Previous == 2).Take(6).Select(pair => $"({pair.Previous},{pair.Next})")));
Console.WriteLine("1000th prime: " + Seq.Primes().ElementAt(999) + ", prime gaps > 12 start at: " + Seq.Primes().Pairwise().First(pair => pair.Next - pair.Previous > 12));

IEnumerable<BigInteger> fibonacci = Seq.Iterate((A: BigInteger.Zero, B: BigInteger.One), state => (state.B, state.A + state.B)).Select(state => state.A);
Console.WriteLine("fibonacci: " + Join(fibonacci.Take(15)));
Console.WriteLine("fib(90)=" + fibonacci.ElementAt(90) + " first with 25 digits: " + fibonacci.First(f => f.ToString().Length == 25));
Console.WriteLine("even fib sum below 4e6: " + fibonacci.TakeWhile(f => f < 4_000_000).Where(f => f.IsEven).Aggregate(BigInteger.Zero, (sum, f) => sum + f));

Console.WriteLine("collatz(6): " + Join(Collatz(6)));
var longest = Naturals().Take(30).Select(n => (Start: n, Length: Collatz(n).Count(), Peak: Collatz(n).Max())).MaxBy(chain => chain.Length);
Console.WriteLine("longest chain below 31: start=" + longest.Start + " length=" + longest.Length + " peak=" + longest.Peak);

Console.WriteLine("triangular: " + Join(Naturals().Scan(0L, (sum, n) => sum + n).Take(10)));
Console.WriteLine("factorials: " + Join(Naturals().Scan(BigInteger.One, (product, n) => product * n).Skip(15).Take(3)));
Console.WriteLine("merge 3s and 5s: " + Join(Multiples(3).Merge(Multiples(5)).Dedupe().Take(14)));
Console.WriteLine("merge all: " + Join(Seq.MergeAll(new long[] { 1, 4, 9 }, new long[] { 2, 3, 10 }, new long[] { }, new long[] { 5 }, new long[] { 0, 6, 7, 8, 11 })));
Console.WriteLine("merge chars: " + string.Concat("acegkz".Merge("bdfhij")) + " " + string.Concat("hello".Merge("").Dedupe()));

string[] fizz = { "", "", "Fizz" }, buzz = { "", "", "", "", "Buzz" };
IEnumerable<string> fizzBuzz = fizz.Cycle().Zip(buzz.Cycle(), (f, b) => f + b).Zip(Naturals(), (word, n) => word.Length > 0 ? word : n.ToString());
Console.WriteLine("fizzbuzz: " + Join(fizzBuzz.Take(15)));

Console.WriteLine("windows of 3 primes: " + Join(Seq.Primes().Windowed(3).Take(5).Select(w => "[" + string.Join("+", w) + "=" + w.Sum() + "]")));
Console.WriteLine("digits of 2^64 in base 7: " + string.Concat(Seq.Unfold<BigInteger, int>(BigInteger.Pow(2, 64), n => n.IsZero ? null : ((int)(n % 7), n / 7)).Reverse()));
Console.WriteLine("binary 37: " + string.Concat(Seq.Unfold<int, int>(37, n => n == 0 ? null : (n % 2, n / 2)).Reverse()) + ", empty unfold count: " + Seq.Unfold<int, int>(0, n => n == 0 ? null : (n, n - 1)).Count());

int pulled = 0;
IEnumerable<long> evenSquares = Naturals().Select(n => { pulled++; return n * n; }).Where(square => square % 2 == 0);
Console.WriteLine("lazy: built with pulled=" + pulled + ", " + Join(evenSquares.Take(3)) + " after pulled=" + pulled + ", again " + evenSquares.First() + " pulled=" + pulled);

try { Seq.Primes().Windowed(0); }
catch (ArgumentOutOfRangeException e) { Console.WriteLine("eager check: " + e.ParamName); }
IEnumerable<int> faulty = Seq.Primes().Select(p => 100 / (p - 7));
Console.WriteLine("lazy failure: first three " + Join(faulty.Take(3)));
try { Console.WriteLine(Join(faulty.Take(5))); }
catch (DivideByZeroException) { Console.WriteLine("lazy failure: DivideByZeroException on the 4th element"); }

using (IEnumerator<int> primes = Seq.Primes().GetEnumerator())
{
    long product = 1;
    int count = 0;
    while (primes.MoveNext() && product * primes.Current < 1_000_000) { product *= primes.Current; count++; }
    Console.WriteLine("primorial below 1e6: " + product + " from " + count + " primes, next prime " + primes.Current);
}

static class Seq
{
    public static IEnumerable<int> Primes()
    {
        var composites = new Dictionary<int, int>();
        yield return 2;
        for (int n = 3; ; n += 2)
        {
            if (composites.Remove(n, out int step))
            {
                int next = n + step;
                while (composites.ContainsKey(next)) next += step;
                composites[next] = step;
            }
            else
            {
                yield return n;
                if ((long)n * n <= int.MaxValue) composites[n * n] = 2 * n;
            }
        }
    }

    public static IEnumerable<T> Iterate<T>(T seed, Func<T, T> next)
    {
        for (T current = seed; ; current = next(current)) yield return current;
    }

    public static IEnumerable<T> Unfold<TState, T>(TState state, Func<TState, (T Value, TState Next)?> step)
    {
        while (step(state) is var (value, next))
        {
            yield return value;
            state = next;
        }
    }

    public static IEnumerable<(T Previous, T Next)> Pairwise<T>(this IEnumerable<T> source)
    {
        using IEnumerator<T> e = source.GetEnumerator();
        if (!e.MoveNext()) yield break;
        T previous = e.Current;
        while (e.MoveNext()) yield return (previous, previous = e.Current);
    }

    public static IEnumerable<TAcc> Scan<T, TAcc>(this IEnumerable<T> source, TAcc seed, Func<TAcc, T, TAcc> fold)
    {
        TAcc acc = seed;
        foreach (T item in source) yield return acc = fold(acc, item);
    }

    public static IEnumerable<T> Merge<T>(this IEnumerable<T> left, IEnumerable<T> right) where T : IComparable<T>
    {
        using IEnumerator<T> a = left.GetEnumerator(), b = right.GetEnumerator();
        bool hasA = a.MoveNext(), hasB = b.MoveNext();
        while (hasA && hasB)
        {
            if (a.Current.CompareTo(b.Current) <= 0) { yield return a.Current; hasA = a.MoveNext(); }
            else { yield return b.Current; hasB = b.MoveNext(); }
        }
        for (; hasA; hasA = a.MoveNext()) yield return a.Current;
        for (; hasB; hasB = b.MoveNext()) yield return b.Current;
    }

    public static IEnumerable<T> MergeAll<T>(params IEnumerable<T>[] sources) where T : IComparable<T> => sources.Length switch
    {
        0 => Enumerable.Empty<T>(),
        1 => sources[0],
        _ => MergeAll(sources[..(sources.Length / 2)]).Merge(MergeAll(sources[(sources.Length / 2)..])),
    };

    public static IEnumerable<T> Dedupe<T>(this IEnumerable<T> source)
    {
        bool first = true;
        T last = default;
        foreach (T item in source)
        {
            if (!first && EqualityComparer<T>.Default.Equals(item, last)) continue;
            yield return last = item;
            first = false;
        }
    }

    public static IEnumerable<T> Cycle<T>(this IReadOnlyList<T> items)
    {
        if (items.Count == 0) yield break;
        for (int i = 0; ; i = (i + 1) % items.Count) yield return items[i];
    }

    public static IEnumerable<T[]> Windowed<T>(this IEnumerable<T> source, int size)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(size);
        return Slide(source, size);

        static IEnumerable<T[]> Slide(IEnumerable<T> source, int size)
        {
            var window = new Queue<T>(size);
            foreach (T item in source)
            {
                window.Enqueue(item);
                if (window.Count < size) continue;
                yield return window.ToArray();
                window.Dequeue();
            }
        }
    }
}
