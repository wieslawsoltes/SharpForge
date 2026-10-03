// langversion 9: expect the language-version diagnostics recorded in the .roslyn.json beside this file
using System;
class A : Attribute { }
class C
{
    void M((int, int) t)
    {
        Func<int> a = [A] () => 1;
        Func<int, int> b = [A] (int x) => x;
        Func<int, int> c = ([A] int x) => x;
        Func<int> d = [return: A] () => 1;
        Func<int> e = int () => 1;
        Func<int, int> f = [A] static int (int x) => x;
        Func<int, int> g = [A] x => x;
        int y;
        (y, var z) = t;
        (var a1, y) = t;
        (int b1, y) = t;
        (y, y) = t;
        (var c1, var d1) = t;
    }
}
struct S
{
    public int X = 1;
    public string Name { get; set; } = "x";
    static int Count = 0;
    public S() { }
    public S(int x) : this() { X = x; }
    static S() { }
}
record struct RS(int A)
{
    public int B = A;
}
