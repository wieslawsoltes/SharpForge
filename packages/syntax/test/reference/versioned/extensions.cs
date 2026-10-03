using System.Collections.Generic;
public static class Extensions
{
    extension<T>(IEnumerable<T> source) where T : class
    {
        public bool IsEmpty => !source.Any();
        public T FirstOrNull() => source.FirstOrDefault();
        public static IEnumerable<T> Empty => [];
        public static IEnumerable<T> operator +(IEnumerable<T> left, IEnumerable<T> right) => left.Concat(right);
        public int Count { get { return source.Count(); } }
    }
    extension(string)
    {
        public static string Repeat(string s, int n) => s;
    }
    [Obsolete] extension(ref int value)
    {
        public void Increment() => value++;
        public void operator +=(int amount) { value += amount; }
        public void operator ++() { value++; }
    }
    extension<TKey, TValue>(Dictionary<TKey, TValue> map) where TKey : notnull where TValue : new() { }
    extension(scoped in System.ReadOnlySpan<char> text) { public bool Blank => text.Length == 0; }
    public static int extension(this int x) => x;
    static int Other(this string extension) => extension.Length;
}
class Counter
{
    int n;
    public void operator +=(int x) { n += x; }
    public void operator checked +=(int x) { checked { n += x; } }
    public void operator -=(Counter c) => n -= c.n;
    public void operator *=(int x) { } public void operator /=(int x) { } public void operator %=(int x) { }
    public void operator &=(int x) { } public void operator |=(int x) { } public void operator ^=(int x) { }
    public void operator <<=(int x) { } public void operator >>=(int x) { } public void operator >>>=(int x) { }
    public void operator ++() { n++; }
    public void operator checked --() { n--; }
    public static Counter operator +(Counter a, Counter b) => a;
    public static Counter operator ++(Counter a) => a;
    void M(Counter extension) { extension += 1; var x = extension; extension++; }
}
