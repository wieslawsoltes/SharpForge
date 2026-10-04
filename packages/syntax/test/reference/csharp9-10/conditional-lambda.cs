using System;
class C
{
    void M(bool b, int[] xs)
    {
        Func<int> a = b ? () => 1 : null;
        Func<int, int> c = b ? x => x : null;
        Func<int, int> d = b ? (x) => x + 1 : y => y;
        Func<int, int, int> e = b ? (x, y) => x + y : (x, y) => x - y;
        Func<int, int> f = b ? (int x) => x : (int x) => -x;
        Action g = b ? () => { } : () => { };
        Func<int> h = b ? static () => 1 : null;
        Func<int> i = b ? async () => 1 : null;
        Func<int, int> j = b ? delegate (int x) { return x; } : null;
        var k = b ? (Func<int>)(() => 1) : () => 2;
        var l = b ? b ? () => 1 : () => 2 : () => 3;
        var m = b ? int () => 1 : null;
        var n = b ? [A] () => 1 : null;
        var o = b ? (a) : null;
        var p = b ? (a, b) : (c, d);
        var q = b ? (int)a : c;
        var r = b ? () => b ? 1 : 2 : null;
        var s = xs is [] ? () => 1 : null;
        var t = b ? ref int () => ref xs[0] : null;
    }
}
