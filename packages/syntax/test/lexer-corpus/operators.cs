class Operators
{
    void M()
    {
        a = b + c - d * e / f % g;
        a += 1; a -= 1; a *= 1; a /= 1; a %= 1; a &= 1; a |= 1; a ^= 1; a <<= 1; a >>= 1; a >>>= 1; a ??= 1;
        a = b << 1 >> 2 >>> 3;
        a = b & c | d ^ e; a = ~b; a = !c;
        a = b && c || d; a = b == c != d; a = b < c > d <= e >= f;
        a++; a--; ++a; --a;
        a = b ?? c; a = b?.c; a = b?[0]; a = b ? c : d; a = b!;
        a = b.c; a = b->c; a = *p; a = &b; a = b::c.d;
        a = x => x; a = 1..2; a = ^1; a = ..;
        List<List<int>> nested; Dictionary<int, List<List<int>>> deep; a = b >> c; a = b >= c;
        var t = (1, 2); var arr = new[] { 1 }; var i = arr[0]; label: ;
        a = b
            >> c;
    }
}
