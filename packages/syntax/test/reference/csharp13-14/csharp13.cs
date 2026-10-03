using System;
using System.Collections.Generic;
class C
{
    void A(params int[] xs) { }
    void B(params List<int> xs) { }
    void D(params Span<int> xs) { }
    void E(params ReadOnlySpan<char> xs) { }
    void F(params IEnumerable<string> xs) { }
    void G(int a, params System.Collections.Generic.IList<int> xs) { }
    void H(params int[][] xs) { }
    delegate void Del(params List<int> xs);
    int this[params ReadOnlySpan<int> xs] => 0;
    C(params HashSet<int> xs) { }
    void M()
    {
        var a = new Buffer { [^1] = 1, [^2] = 2 };
        var b = new Buffer { [0] = 1, [^1] = 2, [1..] = 3 };
        var c = new Outer { Inner = { [^1] = 1 } };
        var d = new Buffer { [^i] = x, [i] = { [^1] = 2 } };
        var e = "\e[1m";
        var f = '\e';
        lock (new System.Threading.Lock()) { }
        void Local(params Span<int> xs) { }
        var g = (params List<int> xs) => xs;
    }
    void T<T1, T2, T3>()
        where T1 : allows ref struct
        where T2 : class, allows ref struct
        where T3 : IDisposable, new(), allows ref struct
    { }
    int allows;
    void N() { int allows = 1; allows++; }
    public partial int P { get; set; }
    public partial int this[int i] { get; }
    ref struct RS : IDisposable { public void Dispose() { } }
    [System.Runtime.CompilerServices.OverloadResolutionPriority(1)] void O() { }
    async System.Threading.Tasks.Task It() { ref int r = ref x; unsafe { } await y; }
}
class G<T> where T : allows ref struct { }
interface I<T> where T : struct, allows ref struct { }
delegate void D2<T>() where T : allows ref struct;
