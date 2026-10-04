using System;
class C
{
    void M(bool b, int[] xs)
    {
        var a = int? () => null;
        var c = b? () => null;
        var d = F(int? () => null, 1);
        var e = b ? int? () => null : null;
        var f = b ? c? () => null : null;
        var g = x ? y ? () => 1 : () => 2 : () => 3;
        var h = x ? y? () => 1 : () => 3;
        var i = b ? () => 1 : c ? () => 2 : () => 3;
        var j = new { A = b ? () => 1 : null, B = 2 };
        var k = F(b ? () => 1 : null, b? () => null);
        var l = b ? () => { var z = b ? 1 : 2; return z; } : null;
        var m = b ? (x) => x switch { 1 => 2, _ => 3 } : null;
    }
}
