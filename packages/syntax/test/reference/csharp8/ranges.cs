class C
{
    void M(int[] a, int i, int j)
    {
        var a1 = a[^1];
        var a2 = a[1..^2];
        var a3 = a[..];
        var a4 = a[i..];
        var a5 = a[..j];
        var a6 = a[^i..^j];
        System.Range r1 = ..;
        System.Range r2 = 1..;
        System.Range r3 = ..2;
        System.Range r4 = 1..2;
        System.Index x1 = ^1;
        System.Index x2 = ^(i + 1);
        var b1 = i + 1..j - 1;
        var b2 = i..j == r1;
        var b3 = -1..-2;
        var b4 = ^^1;
        var b5 = (..);
        var b6 = a[i..j].Length;
        var b7 = i..j + 1;
        var b8 = i * 2..j * 2;
        var b9 = ..^1;
        var c1 = x ? 1.. : ..2;
        var c2 = F(.., 1.., ..2);
        var c3 = new[] { .., 1..2 };
        var c4 = (1..2, ..);
        var c5 = a[^1] + a[^2];
        var c6 = i.. ;
        var c7 = a?[^1];
        var c8 = a[(^1)..(^0)];
        var c9 = x is ..;
        var d1 = i..j switch { _ => 1 };
        var d2 = (int)^1;
        var d3 = !..;
        var d4 = 1.ToString()..2.ToString();
        var d5 = 1.0..2.0;
        var d6 = a[..].Length..;
        foreach (var e in a[1..]) { }
        if (i..j is var q) { }
        var d7 = x ?? ..;
        var d8 = i.. + 1;
    }
}
