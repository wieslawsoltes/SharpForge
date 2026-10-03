class C
{
    void M(dynamic d, dynamic[] e, System.Collections.Generic.List<dynamic> f)
    {
        F(a: 1, b: 2);
        F(1, b: 2);
        F(a: 1, 2);
        F(x: a ? b : c, y: z => z);
        F(ref a, out b, in c);
        F(ref a[0], out this.b, in c.d);
        F(name: ref a, other: out b, third: in c);
        new T(a: 1, b: ref x);
        t[a: 1, b: 2] = 3;
        t[ref x] = 1;
        dynamic local = d;
        dynamic dynamic = 1;
        var x = (dynamic)y;
        var z = y as dynamic;
        var w = y is dynamic;
        dynamic.M();
        dynamic? n = null;
        F(@in: 1, @ref: 2, @out: 3);
        F(a
            : 1);
        base.F(x: 1);
        this.G<int>(value: 2);
        F(a ? b : c);
        F(a ? b : c, d: e);
        var q = new dynamic[2];
        foreach (dynamic item in e) { }
        using (dynamic r = d) { }
    }
    dynamic P { get; set; }
    dynamic F(dynamic a) { return a; }
    [A(1, Name = 2, name: 3)]
    class dynamic { }
}
