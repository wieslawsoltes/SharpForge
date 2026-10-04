using System;
public static class Outer<TKey>
{
    public sealed class Cache<TValue>
    {
        public readonly struct Entry { public Entry(TValue value) { Value = value; } public TValue Value { get; } }
        public static string Describe() => typeof(TKey).Name + "," + typeof(TValue).Name;
        public Entry Make(TValue value) => new Entry(value);
    }
    public static Cache<TValue> Create<TValue>() => new Cache<TValue>();
}
public static class Program
{
    public static void Main()
    {
        Console.WriteLine(Outer<string>.Cache<int>.Describe());
        Console.WriteLine(typeof(Outer<long>.Cache<bool>.Entry).Name);
        Console.WriteLine(Outer<int>.Create<string>().GetType().Name);
        Console.WriteLine(Outer<int>.Create<string>().Make("v").Value);
        var cache = new Outer<byte>.Cache<char>();
        Outer<byte>.Cache<char>.Entry entry = cache.Make('c');
        Console.WriteLine(entry.Value);
    }
}
