class C
{
    int a = default;
    static async System.Threading.Tasks.Task Main() { await x; }
    static async System.Threading.Tasks.Task<int> Main(string[] args) { return await x; }
    void M<T>(T t, int p = default, string s = default, System.Threading.CancellationToken token = default)
    {
        int x = default;
        T y = default;
        var z = default(T);
        x = default;
        F(default);
        F(default, default);
        return default;
        if (x == default) { }
        var b = c ? default : 1;
        var d = default ?? e;
        int[] f = { default, default };
        var g = (default, 1);
        var h = default(int).ToString();
        var i = (int)default;
        var j = default == default;
        switch (x) { case default: break; default: break; }
        var k = x is default;
        var l = x switch { default => 1 };
        var m = new[] { default, 1 };
        Func<int> n = () => default;
        if (t is int v) { }
        switch (t) { case int w: break; case string u when u.Length > 0: break; }
        var o = default!;
        var p2 = default(T)!;
        var tuple = (a: 1, b: 2);
        var inferred = (x, y.z, this.q);
    }
}
