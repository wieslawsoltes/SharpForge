using System;
using System.Collections.Generic;
using System.Threading.Tasks;

class Ring<T>
{
    T[] items;
    public Ring(T[] items) { this.items = items; }
    public IEnumerable<T> From(int start)
    {
        for (int i = 0; i < items.Length; i++) yield return items[(start + i) % items.Length];
    }
    public Func<int, T> Getter() { return index => items[index]; }
    public Func<T> Fixed(T value) { return () => value; }
    public static Func<T, T> Identity() { return x => x; }
    public Func<K, T> Keyed<K>(K key, T fallback) { K held = key; return k => k.Equals(held) ? items[0] : fallback; }
}

static class Sequences
{
    public static IEnumerable<T> Repeat<T>(T value, int times) { for (int i = 0; i < times; i++) yield return value; }
    public static async Task<T> Delayed<T>(T value) { await Task.Delay(1); return value; }
    public static async Task<int> CountAsync<T>(T[] items) { int n = await Delayed(items.Length); return n; }
    public static Func<T, bool> Matcher<T>(T wanted) where T : IComparable<T> { return candidate => candidate.CompareTo(wanted) == 0; }
    public static T[] Map<T>(T[] source, Func<T, T> change)
    {
        T[] result = new T[source.Length];
        int position = 0;
        void Store(T item) { result[position++] = change(item); }
        foreach (T item in source) Store(item);
        return result;
    }
}

class Program
{
    static async Task Main()
    {
        Ring<string> ring = new Ring<string>(new[] { "a", "b", "c" });
        foreach (var s in ring.From(1)) Console.WriteLine(s);
        foreach (var n in new Ring<int>(new[] { 1, 2 }).From(1)) Console.WriteLine(n);
        Console.WriteLine(ring.Getter()(2) + ring.Fixed("f")() + Ring<string>.Identity()("i"));
        Console.WriteLine(ring.Keyed(5, "no")(5) + ring.Keyed(5, "no")(6));
        foreach (var d in Sequences.Repeat(0.5, 2)) Console.WriteLine(d);
        Console.WriteLine(await Sequences.Delayed(41) + 1);
        Console.WriteLine(await Sequences.Delayed("done"));
        Console.WriteLine(await Sequences.CountAsync(new[] { true, false, true }));
        Console.WriteLine(Sequences.Matcher(3)(3) + " " + Sequences.Matcher("x")("y"));
        Console.WriteLine(string.Join(",", Sequences.Map(new[] { "p", "q" }, s => s + s)));
        int calls = 0;
        T Pick<T>(bool first, T a, T b) { calls++; return first ? a : b; }
        void Swap<T>(ref T a, ref T b) { T t = a; a = b; b = t; }
        Console.WriteLine(Pick(true, 1, 2) + Pick(false, "x", "y") + calls);
        string left = "l", right = "r";
        Swap(ref left, ref right);
        int one = 1, two = 2;
        Swap(ref one, ref two);
        Console.WriteLine(left + right + one + two);
    }
}
