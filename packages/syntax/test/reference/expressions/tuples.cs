class Tuples
{
    (int, string) field;
    (int a, string b) Named() { return (1, "x"); }
    (int, (string, double) nested, List<(int x, int y)>) Deep;
    void M()
    {
        (int a, string b) t = (1, "x");
        var (x, (y, z)) = e;
        (int u, var v) = t;
        (a, b) = (b, a);
        (var p, var q) = pair;
        var r = (first: 1, second: "two", 3);
        var s = (a, b: 2);
        (int, int)[] arr = new (int, int)[3];
        (int, int)? maybe = null;
        foreach (var (k, v2) in dict) { }
        foreach ((int p3, int q3) in pairs) { }
        foreach (var item in items) { }
        (x, y) = (y, x);
        var (_, second) = t;
        (_, var third) = t;
        F(out var o1, out int o2, out _, out var _);
        var w = t.Item1 + t.b.Length;
        var eq = (1, 2) == (3, 4);
        Func<(int, int), (int a, int b)> f = p => (p.Item2, p.Item1);
    }
}
