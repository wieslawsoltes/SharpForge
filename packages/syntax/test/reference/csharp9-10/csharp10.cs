class C
{
    void M()
    {
        var a = [A] () => 1;
        var b = [A] (int x) => x;
        var c = [A][B(1)] static (int x, int y) => x + y;
        var d = ([A] int x) => x;
        var e = ([A] ref int x, [B] out int y) => { y = x; };
        var f = [return: A] () => 1;
        var g = int () => 1;
        var h = int (int x) => x;
        var i = string? () => null;
        var j = List<int> () => null;
        var k = ref int (ref int x) => ref x;
        var l = static int (int x) => x;
        var m = async Task<int> () => await x;
        var n = [A] static async Task<int> (int x) => await y;
        var o = int[] () => null;
        var p = (int, int) () => (1, 2);
        var q = N.T<int>.U () => null;
        var r = void () => { };
        var s = [A] x => x;
        Func<int> t = () => 1;
        var u = (int x) => x;
        var v = (ref int x) => x;
        var w = (in int x, out int y) => { y = x; };
        var x1 = (params int[] xs) => xs;
        Delegate d1 = () => { };
        var inferred = Console.WriteLine;
        int y1;
        (y1, var z1) = (1, 2);
        (var a1, y1) = (1, 2);
        (y1, int b1, var (c1, d1x)) = t3;
        (int e1, y1) = (1, 2);
        (y1, (var f1, y1)) = t4;
        F([A] () => 1, [B] x => x);
        var arr = new[] { [A] () => 1 };
        var cond = flag ? [A] () => 1 : [B] () => 2;
        var paren = ([A] () => 1);
        const string cs = $"a{nameof(M)}b";
    }
}
struct S
{
    public int X = 1;
    public string Name { get; set; } = "x";
    static int Count = 0;
    public S() { }
    public S(int x) : this() { X = x; }
}
record struct RS(int A)
{
    public int B = A;
    public RS() : this(0) { }
}
record R
{
    public sealed override string ToString() => "";
}
