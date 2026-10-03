using System;
ref struct R
{
    void M(scoped ref int a, scoped Span<int> b, scoped in int c, ref readonly int d, scoped ref readonly int e, out int f)
    {
        f = 0;
        scoped Span<int> s = default;
        scoped ref int r = ref a;
        scoped ref readonly int rr = ref c;
        scoped var v = b;
        N(ref a, in d);
        N(in a, d);
    }
    void N(ref readonly int x, in int y) { }
    delegate void D(scoped ref int x, ref readonly int y);
    public R this[scoped ref int i] => this;
}
class scoped { }
class Uses
{
    scoped field;
    scoped Method(scoped p) { scoped local = p; int scoped = 1; scoped++; return local; }
    void Call(scoped scoped) { Call(scoped); }
}
