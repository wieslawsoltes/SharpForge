// langversion 7.2: expect the language-version diagnostics recorded in the .roslyn.json beside this file
using System.Linq;
class B { public B(int x) { } }
class C : B
{
    static object o = 1;
    static bool F(out int value) { value = 1; return true; }
    int a = o is int i ? i : 0;
    int P { get; } = F(out int p) ? p : 0;
    C() : base(F(out var c) ? c : 0) { }
    void M(int[] xs)
    {
        var q = from x in xs where F(out var w) select x;
        var r = from x in xs select (o is int k ? k : 0);
        (int a1, int b1) = (1, 2);
    }
    [field: System.NonSerialized] public event System.Action E;
    System.Func<int> g = () => F(out var l) ? l : 0;
    int t = F(out var (u, v)) ? 1 : 0;
}
