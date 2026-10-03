using System.Collections.Generic;
class TypeOps<T>
{
    void M(object o)
    {
        bool a = o is int;
        bool b = o is string && o is List<int>;
        bool c = o is int[] || o is long;
        string s = o as string;
        var l = o as List<int> ?? new List<int>();
        var t1 = typeof(int); var t2 = typeof(string[]); var t3 = typeof(List<>); var t4 = typeof(Dictionary<,>);
        var t5 = typeof(Dictionary<string, List<int>>); var t6 = typeof(void); var t7 = typeof(global::System.Int32); var t8 = typeof(Outer<>.Inner<,>); var t9 = typeof(int?);
        var t10 = typeof(int*); var t11 = typeof(T); var t12 = typeof(System.Collections.Generic.Dictionary<,>.Enumerator);
        int size = sizeof(int) + sizeof(long) * sizeof(byte);
        var d1 = default(int); var d2 = default(string); var d3 = default(List<int>); var d4 = default(T[]); var d5 = default(int?);
        bool e = o is System.IDisposable == true;
        bool f = (o as string) != null && !(o is null);
        var g = o is int ? 1 : 2;
        var h = o is string ? "s" : o is int ? "i" : "o";
        var i = (o as int?) ?? 0;
        var j = o as int? ?? 1;
        bool k = o is int == o is long;
        bool m = o is int? ;
        var n = o is T[] ? default(T) : (o as T[])[0];
        bool p = typeof(T) == typeof(int) || o.GetType() == typeof(List<T>);
    }
}
