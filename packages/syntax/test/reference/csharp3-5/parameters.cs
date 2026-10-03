static class E
{
    public static int Count(this string s) { return 0; }
    public static T First<T>(this System.Collections.Generic.IEnumerable<T> source, int skip = 0) { return default(T); }
    public static void A(this ref int x) { }
    public static void B(ref this int x) { }
    public static void C(this in int x) { }
    public static void D(in this int x) { }
    static void F(int a = 1, string b = "x", object c = null, double d = 1.5 + 2, int[] e = default(int[]), params int[] rest) { }
    static void G([In] ref int a, [Out] out int b, [A, B][C] params object[] c) { }
    static void H(this int[] a, int b = -1, bool c = true, char d = 'x', E e = E.A | E.B) { }
}
class P
{
    public int Auto { get; set; }
    public int ReadOnly { get; private set; }
    public static string S { get; set; }
    internal virtual int V { get; protected internal set; }
    partial void OnChanged();
    partial void OnChanging(int value);
    partial void OnChanged() { }
    static partial void S1<T>(T t) where T : class;
    int this[int i, int j = 0] { get { return 0; } }
    P(int a = 0) { }
    delegate void D(int a = 0, params int[] b);
    public static P operator +(P a, P b = null) { return a; }
}
