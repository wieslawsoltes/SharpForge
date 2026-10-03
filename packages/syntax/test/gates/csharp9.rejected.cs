// langversion 8: expect the language-version diagnostics recorded in the .roslyn.json beside this file
using System;
using System.Collections.Generic;
class Point { public int X; public Point() { } public Point(int x) { X = x; } }
class C
{
    Point field = new();
    List<int> list = new() { 1, 2 };
    Point init = new(1) { X = 1 };
    void M(Point p)
    {
        Point local = new();
        p = new(3);
        Func<int, int> s1 = static x => x;
        Func<int> s2 = static () => 1;
        Func<int> s3 = static delegate { return 1; };
        Func<int, int, int> d1 = (_, _) => 1;
        Func<int, int, int> d2 = (int _, int _) => 1;
        Func<int, int, int> d3 = delegate (int _, int _) { return 1; };
        Func<int, int> d4 = _ => 1;
    }
}
