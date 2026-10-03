class C
{
    int[] field = [1, 2, 3];
    int[] empty = [];
    List<int> P { get; } = [1];
    void M(int[] xs, int[] ys)
    {
        int[] a = [1, 2, 3];
        int[] b = [];
        int[] c = [1, ..xs];
        int[] d = [..xs, ..ys];
        int[] e = [.. xs, 4, .. ys, 5,];
        int[][] f = [[1, 2], [3], []];
        var g = (int[])[1];
        var h = (List<int>)[1, 2];
        var i = (int[])[];
        Span<int> j = [x, y.z, f(), a[0]];
        F([1, 2], []);
        F([..xs]);
        a = [1];
        a = cond ? [1] : [2];
        a = cond ? [] : [..xs];
        var k = xs is [1, 2];
        foreach (var v in (int[])[1, 2]) { }
        return [1, 2];
        [Attr] void Local() { }
        [Attr] static int Local2() => 1;
        var l = a[0];
        var m = a[1..];
        var n = x?[0];
        int[] o = [a ? b : c, d ?? e, f => f];
        int[] p = [.. a ? b : c];
        int[] q = [..[1, 2], ..[3]];
        var r = [1, 2].Length;
        var s = [1, 2][0];
        [1, 2].ToString();
        ([1, 2]).ToString();
        var t = ([1, 2]);
        var u = (a)[1];
        var v2 = (A.B)[1];
        var w = (int)[1];
        var x1 = (a + b)[1];
        var y1 = (A<int>)[1];
        var z1 = (a[0])[1];
        IEnumerable<int> seq = [.. from i2 in xs select i2];
        object boxed = (object)[1];
        var dict = new D { [1] = 2 };
        x[1] = [2];
        var lam = [Attr] () => 1;
    }
    [Attr] int Q => 1;
}
