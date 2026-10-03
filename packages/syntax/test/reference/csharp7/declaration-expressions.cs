class C
{
    void M()
    {
        F(out var x);
        F(out int y);
        F(out _);
        F(out var _);
        F(out int _);
        F(out System.Collections.Generic.List<int> z);
        F(out int[] a, out int? b, out (int, string) c);
        F(out N.T<int>.U d);
        if (int.TryParse(s, out var n) && n > 0) { }
        while (F(out var w)) { }
        var r = F(out var q) ? q : 0;
        F(name: out var named);
        _ = F();
        _ = _ + 1;
        (_, _) = t;
        (var p, _) = t;
        var (_, k) = t;
        (int _, var _) = t;
        F(out a.b);
        F(out a[0]);
        F(out var (u, v));
        new T(out var ctor);
        t[out var index] = 1;
        F(ref x, out var x2, in x);
        F(out dynamic dyn);
        F(out var @var);
        var m = M(out var o1) + M(out int o2);
        int _ = 1;
        F(_ => 1);
        F((_, _) => 1);
    }
    int f = F(out var fieldVar);
    int P { get; } = F(out var propVar) ? 1 : 0;
    C() : this(out var ctorVar) { }
}
