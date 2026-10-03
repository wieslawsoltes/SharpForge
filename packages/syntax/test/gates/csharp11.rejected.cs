// langversion 10: expect the language-version diagnostics recorded in the .roslyn.json beside this file
using System;
class Attr<T> : Attribute { }
[Attr<int>]
class C
{
    [Attr<string>] void M() { }
    void P([Attr<int>] int p) { }
}
file class F1 { }
file struct F2 { }
file interface F3 { }
file enum F4 { A }
file delegate void F5();
file record F6(int A);
file static class F8 { }
interface IOps<TSelf> where TSelf : IOps<TSelf>
{
    static abstract TSelf operator +(TSelf a, TSelf b);
    static virtual TSelf operator *(TSelf a, TSelf b) => a;
    static abstract TSelf Zero { get; }
    static abstract TSelf Create(int value);
    static virtual void Log() { }
    static abstract event Action E;
    abstract static void Order();
    static void Plain() { }
    static abstract explicit operator int(TSelf a);
}
struct V
{
    public static V operator +(V a, V b) => a;
    public static V operator checked +(V a, V b) => a;
    public static V operator checked -(V a) => a;
    public static explicit operator checked int(V a) => 0;
    public static explicit operator int(V a) => 0;
    public static V operator >>>(V a, int b) => a;
    void M(int a, int b)
    {
        var s1 = a >>> b;
        a >>>= b;
    }
}
