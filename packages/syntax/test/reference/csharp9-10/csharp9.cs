class C
{
    Point field = new();
    Point other = new(1, 2);
    List<int> list = new() { 1, 2 };
    Point init = new() { X = 1, Y = 2 };
    Dictionary<string, int> map = new() { ["a"] = 1 };
    Point[] array = { new(1, 2), new(), new() { X = 1 } };
    nint a;
    nuint b;
    nint[] c;
    nint? d;
    System.Collections.Generic.List<nuint> e;
    void M(nint p, nuint q)
    {
        Point local = new();
        local = new(3, 4);
        F(new(), new(1), new() { X = 1 });
        var t = (new(), 1);
        nint n = 1;
        nuint u = (nuint)n;
        var size = sizeof(nint);
        var type = typeof(nuint);
        int nint = 1;
        nint = nint + 1;
        Func<int, int> s1 = static x => x;
        Func<int, int, int> s2 = static (x, y) => x + y;
        Func<int> s3 = static () => 1;
        Func<int> s4 = static delegate { return 1; };
        Func<Task> s5 = static async () => await x;
        Func<Task> s6 = async static () => await x;
        Func<int, int, int> d1 = (_, _) => 1;
        Func<int, int, int, int> d2 = (_, _, _) => 1;
        Func<int, int, int> d3 = (int _, int _) => 1;
        Func<int, int> d4 = _ => 1;
        Func<int, int, int> d5 = delegate (int _, int _) { return 1; };
        var cond = b ? new() : other;
        return new();
        throw new();
        var x1 = new() + new();
        var x2 = new().ToString();
        var x3 = new()[0];
        var x4 = (new(), new());
        var tuple = new (int, int)();
        var tupleArray = new (int, int)[2];
        var nullableTuple = new (int, int)?();
        lock (new()) { }
        using (new()) { }
        foreach (var z in new()) { }
        yield return new();
        await new();
    }
    [module: System.Runtime.CompilerServices.SkipLocalsInit]
    public override Derived Clone() => new();
    [System.Runtime.CompilerServices.ModuleInitializer]
    internal static void Init() { }
    public static implicit operator C(int i) => new();
    Point P { get; } = new();
    Point Q => new(1, 2);
}
