class Ambiguities
{
    void M()
    {
        var a = c ? a?[0] : b;
        var b = c ? [1] : [2];
        var d = a?[0];
        var e = a?.b?.c(1)[2].d;
        a?.b?.c(1)[2].d = 5;
        a?.Invoke();
        a?[1]?.x?[2] ??= 3;
        var f = a is T ? b : c;
        var g = x as T? ;
        var h = x as T ?? y;
        var i = x as int? ?? 0;
        int? n1 = null;
        int[]? n2 = null;
        int?[] n3 = null;
        List<int?>? n4 = null;
        string?[]?[] n5 = null;
        var j = x!;
        var k = x!.y!.z!;
        var l = x![0]!();
        var m = !x!;
        var n = x! == y!;
        var o = a ?? b ?? c;
        var p = a ? b : c ? d : e;
        var q = a ? b ? c : d : e;
        var r = F<A, B>(x);
        var s = F<A, B>.G();
        var t = a < b > c;
        var u = a < b > (c);
        var w = x = a < b ? c : d;
        var y = G<int[]>(1);
        var z = G<List<List<int>>>(1);
        var a2 = G<(int, int)>(1);
        var b2 = a.b<c>.d();
        var c2 = A<B>.C();
        var d2 = F(G<A, B>(7));
        var e2 = F(G < A, B > 7);
        var f2 = a < b >> c;
        var g2 = a >> b;
        var h2 = a >>> b;
        x >>= 1; x >>>= 2; x <<= 3;
        var i2 = a > b ? c : d;
        var j2 = a >= b;
        var k2 = typeof(Dictionary<,>);
        var l2 = typeof(List<>.Enumerator);
        var m2 = new List<List<int>>();
        var n2b = a is List<int> ? 1 : 2;
        var o2 = (List<int>)x;
        var p2 = default(List<int>);
        var q2 = nameof(List<int>.Count);
    }
}
