class C
{
    const int Width = 8;
    void M(int x, int w, bool b)
    {
        var a = $"{x,Width}";
        var c = $"{x,-Width}";
        var d = $"{x, Width + 2 :F2}";
        var e = $"{x,w}";
        var f = $"{x,(Width)}";
        var g = $"{x,(b ? 1 : 2)}";
        var h = $"{x,C.Width:X}";
        var i = $"{x,1.5}";
        var j = $"{x,"s"}";
        var k = $"{x,+3}";
        var l = $"{x,200000}";
        var m = $@"{x,Width}";
        var n = $"""{x,Width}""";
        var o = $"{x,sizeof(int)}{x,(int)2L}";
    }
}
