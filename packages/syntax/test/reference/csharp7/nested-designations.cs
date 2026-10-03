class C
{
    void M()
    {
        (var x, var (y, z)) = t;
        (var a, (var b, var (c, d))) = t;
        (int e, var (f, (g, h))) = t;
        (var (i, j), var k) = t;
        (var (l, m), n) = t;
        var (o, (p, q)) = t;
        foreach ((var r, var (s, u)) in ts) { }
        var w = (var (x1, y1), 2);
        F(var (a1, b1));
        (var(c1, d1)) = t;
    }
}
