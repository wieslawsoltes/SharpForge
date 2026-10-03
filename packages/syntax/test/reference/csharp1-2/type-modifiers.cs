public static class Util { public static int Twice(int x) { return x * 2; } }
static partial class Parts { }
partial class Parts { }
public partial struct PS { }
internal partial interface PI { }
partial struct PS : PI { }
public sealed partial class Sealed { partial class Inner { } static class Nested { } protected internal partial struct Deep { } }
abstract partial class Abs<T> where T : class { }
unsafe static class U { }
public static partial class Twice { }
partial interface PI { void M(); }
class Coalesce
{
    void M(int? a, int? b, string s, object o)
    {
        int c = a ?? b ?? 0;
        int? d = a ?? b;
        var e = a ?? (b ?? 1);
        var f = (a ?? b) ?? 2;
        string g = s ?? o as string ?? "default";
        int? h = null, i = 5;
        var j = h.HasValue ? h.Value : i ?? 0;
        var k = a ?? b > 0 ? 1 : 2;
        var l = a + 1 ?? b * 2;
        int?[] m = new int?[] { 1, null };
        System.Nullable<int> n = a;
        var q = (int?)null ?? default(int?) ?? 0;
        bool r = a == null || a.Value > 0 && !b.HasValue;
        var t = a ?? b ?? c ?? d ?? 1;
        var u = a ?? (int?)b ?? (o as int?) ?? 3;
        a = a ?? 1; b = (b ?? a) ?? c;
    }
}
