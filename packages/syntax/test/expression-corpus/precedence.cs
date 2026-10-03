class Precedence
{
    void M()
    {
        var a = 1 + 2 * 3 - 4 / 5 % 6;
        var b = a << 1 + 2 >> 3;
        var c = a < b == c > d != e <= f;
        var d = a & b ^ c | d && e || f;
        var e = a ?? b ?? c;
        var f = a ? b : c ? d : e;
        var g = a = b = c;
        var h = a += b -= c *= d /= e %= f &= g |= h ^= i <<= j >>= k >>>= l ??= m;
        var i = (int)x + (A)y + (A.B)(z) + (A) - 1 + (int[])o + (int?)p + (A)!q + (A)~r + (A)"s" + (A)this.t;
        var j = (a)(b);
        var k = (a) - b;
        var l = (int)-b;
        var m = (a)[0];
        var n = (a).b;
        var o = (A)(B)c;
        var p = (a) is B;
        var q = (A)await t;
        var r = -x switch { 1 => 2, _ => 3 };
        var s = a with { B = 1 } with { C = 2 };
        var t = a + b switch { _ => 1 } + c;
        var u = ^1..^2;
        var v = ..;
        var w = 1..;
        var x1 = ..2;
        var y = a..b + c;
        var z = -a..-b;
        var a2 = !a && -b > +c || ~d == e++ + --f;
        var b2 = a++ + ++b - c-- - --d;
        var c2 = &a->b + *p * *q;
        var d2 = a ?? throw new E();
        var e2 = a ? throw new E() : b;
        var f2 = await a + await b.c();
        var g2 = x is int == true;
        var h2 = x as string + "s";
        var i2 = a == b is bool;
        var j2 = new A().B().C[0].D;
        var k2 = new A { B = 1 }.C;
        var l2 = new int[] { 1, 2 }.Length;
        var m2 = new[] { 1, 2 }[0];
        var n2 = typeof(A).Name + sizeof(int) + default(int) + checked(a + b) + unchecked(a * b);
        var o2 = a is b ? c : d;
        var p2 = a ? b = c : d = e;
        var q2 = a || b ? c && d : e ?? f;
        var r2 = x => y => x + y;
        var s2 = a = b ? c : d;
        var t2 = a ?? (b ? c : d);
        var u2 = (a, b).Item1 + ((c));
        var v2 = a.b?.c ?? d?.e.f!;
        var w2 = stackalloc int[2] { 1, 2 };
        var x2 = a * (b + c) * -(d - e);
        var y2 = cond ? ref a : ref b;
        var z2 = x is not null and var nn ? nn : y;
    }
}
