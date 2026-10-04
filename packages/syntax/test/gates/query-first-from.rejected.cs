// langversion 7.2: expect the language-version diagnostics recorded in the .roslyn.json beside this file
using System.Linq;
class C
{
    static int[] F(out int n) { n = 1; return new int[0]; }
    static object o;
    object field = from x in F(out var inField) select x;
    object joined = from x in new int[0] join y in F(out var inJoin) on x equals y select x;
    void M()
    {
        var a = from x in F(out var n) select x + n;
        var b = from x in o is int[] p ? p : null select x;
        var c = from x in F(out var q) from y in F(out var r) select x;
        var d = from x in F(out var s) where F(out var t) != null select x;
        var e = from x in F(out var u) let z = F(out var v) select x;
        var f = from x in F(out var g) join y in F(out var h) on x equals y select x;
        var i = from x in (from y in F(out var j) select y) select x;
        var k = from x in F(out var l) select (from y in F(out var m) select y);
        var aa = from x in F(out var ab) join y in F(out var ac) on F(out var ad).Length equals F(out var ae).Length select x;
        var af = from x in F(out var ag) orderby F(out var ah).Length select x;
        var ai = from x in F(out var aj) group x by F(out var ak).Length;
        var al = from x in F(out var am) select x into z join w in F(out var an) on z equals w select z;
        var ao = from x in o is int[] ap ? ap : null where o is int aq select x;
        var ar = from x in F(out int at) select F(out int au);
        System.Func<object> av = () => from x in F(out var aw) select x;
    }
}
