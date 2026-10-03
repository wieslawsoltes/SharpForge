class C
{
    void M()
    {
        var a = new { A = 1, B = "x" };
        var b = new { b.C, d, e.f.g, A = 1, };
        var c = new { };
        var d = new { this.X, base.Y, C.Z, p?.Q, r<int>.S, T = new { U = 1 } };
        var e = new[] { 1, 2, 3 };
        var f = new[] { new { A = 1 }, new { A = 2 } };
        var g = new[,] { { 1, 2 }, { 3, 4 } };
        var h = new[] { new[] { 1 }, new[] { 2, 3 } };
        var i = new[,,] { };
        var j = new[] { 1 }[0];
        var k = new { A = 1 }.A;
        var l = new { x = a => a, y = (int)z };
    }
}
