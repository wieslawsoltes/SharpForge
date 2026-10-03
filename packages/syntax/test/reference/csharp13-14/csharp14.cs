class C
{
    void M()
    {
        a?.b = c;
        a?.b.c = d;
        a?[0] = c;
        a?.b[0] = c;
        a?.b += 1;
        a?.b -= 1;
        a?.b *= 2;
        a?.b /= 2;
        a?.b ??= c;
        a?.b <<= 1;
        a?.b >>= 1;
        a?.b >>>= 1;
        a?.b |= 1;
        a?.b &= 1;
        a?.b ^= 1;
        a?.b %= 2;
        a?.b?.c = d;
        a?.b = c = d;
        a?.b = c?.d = e;
        x = a?.b = c;
        a?.E += handler;
        a?.b().c = d;
        var n1 = nameof(List<>);
        var n2 = nameof(Dictionary<,>);
        var n3 = nameof(List<>.Count);
        var n4 = nameof(Outer<>.Inner<,>);
        var n5 = nameof(System.Collections.Generic.List<>);
        var n6 = nameof(global::System.Collections.Generic.Dictionary<,>.Keys);
        var n7 = nameof(List<int>);
        var n8 = nameof(a.b);
        var t1 = typeof(List<>);
        var l1 = (ref x) => x;
        var l2 = (out x) => { x = 1; };
        var l3 = (in x) => x;
        var l4 = (ref x, out y) => { y = x; };
        var l5 = (scoped ref x) => x;
        var l6 = (ref readonly x) => x;
        var l7 = (params x) => x;
        var l8 = (x, ref y) => x;
        var l9 = (scoped x) => x;
        var l10 = (ref x, int y) => x;
        var l11 = async (ref x) => x;
        var l12 = static (out x) => { x = 1; };
        var l13 = ([A] ref x) => x;
        TryParse parse = (text, out result) => int.TryParse(text, out result);
    }
}
