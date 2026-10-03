using System;
[Attr<int>]
[Attr<string, int>(1, Name = 2)]
[N.Attr<List<int>>, Other<int[]>]
class C
{
    [Attr<T>] void M<T>() { }
    [return: Attr<int>] int R() => 1;
    void P([Attr<int>] int p) { }
    [field: Attr<int>] int Prop { get; set; }
    [global::N.Attr<int>] int f;
}
file class F1 { }
file struct F2 { }
file interface F3 { }
file enum F4 { A }
file delegate void F5();
file record F6(int A);
file record struct F7(int A);
file static class F8 { }
file partial class F9 { }
file sealed class F10 { }
file abstract class F11 { }
file readonly struct F12 { }
file ref struct F13 { }
public file class F14 { }
[Attr] file class F15 { }
file unsafe class F16 { }
class D
{
    int file;
    void N() { int file = 1; file++; var x = file + 1; file.M(); }
}
interface IOps<TSelf> where TSelf : IOps<TSelf>
{
    static abstract TSelf operator +(TSelf a, TSelf b);
    static abstract TSelf operator -(TSelf a);
    static virtual TSelf operator *(TSelf a, TSelf b) => a;
    static abstract bool operator ==(TSelf a, TSelf b);
    static abstract bool operator !=(TSelf a, TSelf b);
    static abstract implicit operator int(TSelf a);
    static abstract explicit operator TSelf(int a);
    static abstract TSelf operator checked +(TSelf a, TSelf b);
    static abstract explicit operator checked int(TSelf a);
    static abstract TSelf Zero { get; }
    static abstract TSelf Create(int value);
    static virtual void Log() { }
    static abstract event Action E;
    static abstract TSelf operator ++(TSelf a);
    static abstract TSelf operator checked ++(TSelf a);
    static abstract bool operator true(TSelf a);
    static abstract bool operator false(TSelf a);
    static abstract TSelf operator >>>(TSelf a, int b);
    abstract static void Order();
    public static abstract void Public();
}
struct V : IOps<V>
{
    public static V operator +(V a, V b) => a;
    public static V operator checked +(V a, V b) => a;
    public static V operator -(V a) => a;
    public static V operator checked -(V a) => a;
    public static V operator checked -(V a, V b) => a;
    public static V operator checked *(V a, V b) => a;
    public static V operator checked /(V a, V b) => a;
    public static V operator checked ++(V a) => a;
    public static V operator checked --(V a) => a;
    public static explicit operator checked int(V a) => 0;
    public static explicit operator int(V a) => 0;
    static V IOps<V>.operator +(V a, V b) => a;
    static V IOps<V>.operator checked +(V a, V b) => a;
    static explicit IOps<V>.operator int(V a) => 0;
    static explicit IOps<V>.operator checked int(V a) => 0;
    static int IOps<V>.Zero => 0;
}
class G
{
    int checked1;
    void M() { var a = checked(1 + 2); checked { } var b = unchecked(3); }
}
