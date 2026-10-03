// langversion 11: expect the language-version diagnostics recorded in the .roslyn.json beside this file
using System;
using System.Collections.Generic;
using P = (int x, int y);
using A = int[];
using N = int?;
using unsafe X = int*;
using L = System.Collections.Generic.List<int>;
using I = int;
class C
{
    int[] field = [1, 2, 3];
    void F(int[] xs)
    {
        var a = (int x = 1) => x;
        var b = (int x, int y = 2) => x + y;
        var d = (params int[] ys) => ys.Length;
        var e = (int x, params int[] ys) => x;
        int[] c = [1, ..xs];
        int[] f = [];
        List<int> g = [..xs, ..xs];
    }
    void H(ref readonly int x) { }
}
class Primary(int a)
{
    int field = a;
}
struct PS(int x);
