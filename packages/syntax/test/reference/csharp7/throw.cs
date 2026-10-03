class C
{
    int field = x ?? throw new E();
    int M(object o) => o != null ? 1 : throw new E();
    int N(object o) => o == null ? throw new E() : 2;
    void V() => throw new E();
    int P => throw new E();
    int Q { get => throw new E(); set => throw new E(); }
    C() => throw new E();
    void B()
    {
        var a = x ?? throw new E("x");
        var b = c ? d : throw e;
        var f = c ? throw e : d;
        Func<int> g = () => throw new E();
        Func<int, int> h = v => throw new E();
        a = b ?? throw new E();
        var i = j ?? k ?? throw new E();
        var l = m ?? throw n ?? o;
        F(x ?? throw new E());
        return x ?? throw new E();
    }
    void Invalid()
    {
        var a = throw new E();
        F(throw new E());
        var b = 1 + throw new E();
        var c = (throw new E());
        var d = throw e ?? f;
        var g = x && throw e;
        var h = x ? throw a : throw b;
        var i = new[] { throw e };
        var j = -throw e;
        var k = (int)throw e;
        var l = x == throw e;
        var m = x is T ? y : throw e;
        throw throw e;
    }
}
