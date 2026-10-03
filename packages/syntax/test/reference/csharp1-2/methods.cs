using System;
using System.Collections.Generic;
class Methods
{
    T Identity<T>(T value) { return value; }
    static void Swap<T>(ref T a, ref T b) where T : struct { T t = a; a = b; b = t; }
    TResult Map<TSource, TResult>(TSource source) where TSource : class, new() where TResult : IComparable<TResult> { return default(TResult); }
    void IGeneric<int>.Run<U>(U u) { }
    public virtual List<T> Make<T>() { return null; }
    public abstract void Abstract<[Attr] T>(T value);
    void M(Methods a, int x, int y)
    {
        a.Identity<int>(x);
        a.Map<string, int>("s");
        Identity<List<int>>(null);
        Swap<int>(ref x, ref y);
        var f = a.Identity<Dictionary<string, List<int>>>(null);
        var g = Methods.Static<int>.Value;
        var h = a.b.c<int>.d<string>(1);
        var i = F(G<A, B>(7));
        var j = F(G < A, B > 7);
        var k = F(G<A, B>>7);
        var l = x < y;
        var m = a < b > c;
        var n = a.M<int>;
        var o = new List<int>.Enumerator();
        var p = global::System.Linq.Enumerable.Empty<int>();
        var q = x is List<int> ? 1 : 0;
        Action<int> r = Identity<int>;
        var s = (List<int>)null;
        var t = M<A>(x) + N<B, C<D>>.E;
        var u = a.Make<int[]>() ?? a.Make<int?>() as object;
        var v = x < y && y > x;
        var w = A<B>.C<D>.E<F>(1);
    }
}
