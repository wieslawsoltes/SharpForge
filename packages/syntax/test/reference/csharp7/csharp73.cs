class C<T, U, V, W>
    where T : unmanaged
    where U : System.Enum
    where V : System.Delegate, new()
    where W : struct, System.Enum
{
    [field: System.NonSerialized]
    public int A { get; set; }
    [field: Obsolete, Other]
    [property: P]
    public static int B { get; } = 1;
    [field: System.NonSerialized] public event System.Action E;
    [field: A][method: B][return: C][param: D][type: E][typevar: F][event: G][property: H][assembly: I][module: J]
    int f;
    int g = F(out var x) ? x : 0;
    int h = o is int i ? i : 0;
    static int s = (y is var z) ? 1 : 2;
    public int P { get; } = F(out var p) ? p : 0;
    C() : this(F(out var c)) { }
    C(int a) : base(a is int b ? b : 0) { }
    void M<X>() where X : unmanaged, System.IDisposable
    {
        var q = from a in b
                let c = F(out var d) ? d : 0
                where a is int e && e > 0
                select F(out var g) ? g : a;
        var r = from a in b
                join c in d on (a is var l ? l : a) equals (c is var m ? m : c)
                orderby F(out var n)
                group a by F(out var k);
        int unmanaged = 1;
        var t = (1, 2) == (3, 4);
        var u = (a, b) != (c, d);
        Span<int> sp = stackalloc int[] { 1, 2 };
        ref int rr = ref a;
        rr = ref b;
        for (ref int fr = ref a; ; ) { }
        foreach (ref int fe in span) { }
        foreach (ref readonly int fe2 in span) { }
        fixed (int* ptr = custom) { }
    }
    unmanaged field2;
    void N(unmanaged u) { }
}
