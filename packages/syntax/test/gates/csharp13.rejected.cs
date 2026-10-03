// langversion 12: expect the language-version diagnostics recorded in the .roslyn.json beside this file
using System;
using System.Collections.Generic;
class Buffer { public int this[Index i] { get => 0; set { } } public int Length => 1; public Buffer Inner => this; }
partial class C
{
    void A(params int[] xs) { }
    void B(params List<int> xs) { }
    void D(params Span<int> xs) { }
    void G(int a, params IList<int> xs) { }
    delegate void Del(params List<int> xs);
    int this[params ReadOnlySpan<int> xs] => 0;
    void M()
    {
        var a = new Buffer { [^1] = 1, [0] = 2 };
        var c = new Buffer { Inner = { [^1] = 1 } };
        var e = "\e[1m";
        void Local(params Span<int> xs) { }
    }
    void T<T1, T2>()
        where T1 : allows ref struct
        where T2 : class, allows ref struct
    { }
    public partial int P { get; set; }
    public partial int P { get => 0; set { } }
    public partial int this[int i] { get; }
    public partial int this[int i] { get => 0; }
}
