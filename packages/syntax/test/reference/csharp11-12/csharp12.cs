using P = (int x, int y);
using Q = (int, string);
using A = int[];
using N = int?;
using L = System.Collections.Generic.List<int>;
using unsafe X = int*;
using unsafe Y = delegate*<int, void>;
using D = System.Collections.Generic.Dictionary<string, (int, int)[]>;
using I = int;
using S = string;
using T = (int a, (string b, int c) d)[];
using static unsafe System.Runtime.CompilerServices.Unsafe;
using M = System.Math;
using G = global::System.Int32;
class C
{
    void F()
    {
        var a = (int x = 1) => x;
        var b = (int x, int y = 2) => x + y;
        var c = (string s = "a", bool f = true) => s;
        var d = (params int[] xs) => xs.Length;
        var e = (int x, params int[] xs) => x;
        var g = (int x = default, object o = null) => x;
        var h = ([A] int x = 1) => x;
        var i = static int (int x = 1) => x;
        var j = (ref int x, in int y, out int z) => { z = x + y; };
        var k = (int x = 1 + 2, int y = (3)) => x;
        var l = (params List<int> xs) => xs;
        var m = (x = 1) => x;
        Func<int, int> n = delegate (int x = 1) { return x; };
    }
    void G(params int[] xs) { }
    void H(ref readonly int x, in int y) { }
}
class Primary(int a, string b) : Base(a)
{
    int field = a;
}
struct PS(int x);
[System.Runtime.CompilerServices.InlineArray(4)]
struct Buffer { int element; }
