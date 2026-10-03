using Alias = System.Collections.Generic;
unsafe class Types
{
    int a; uint b; long c; ulong d; short e; ushort f; byte g; sbyte h; float i; double j; decimal k; bool l; char m; string n; object o;
    nint p; nuint q; dynamic r;
    System.Int32 s;
    global::System.String t;
    Alias::List<int> u;
    List<Dictionary<string, List<int>>> v;
    Outer<int>.Inner<string>.Leaf w;
    int[] x; int[,] y; int[,,][] z; int[][][] aa;
    int? bb; int?[] cc; int[]? dd; List<int?>? ee; System.Nullable<int> ff;
    int* gg; int** hh; void* ii; int*[] jj; Foo<int>* kk;
    (int, string) ll; (int a, string b) mm; (int, (int, int))[] nn; (int x, int y)? oo;
    delegate*<int, void> pp;
    delegate* managed<int, int> qq;
    delegate* unmanaged<int, int> rr;
    delegate* unmanaged[Cdecl, SuppressGCTransition]<ref int, out int, in int, readonly ref int, void> ss;
    delegate*<delegate*<int>, int>[] tt;
    ref int M1(ref readonly int a, scoped ref int b) { return ref a2; }
    ref readonly int M2() { return ref a; }
    void M3()
    {
        var a = typeof(int); var b = typeof(List<>); var c = typeof(Dictionary<,>); var d = typeof(int[]); var e = typeof(int?); var f = typeof(void); var g = typeof(int*);
        var h = typeof((int, string)); var i = typeof(delegate*<int>); var j = typeof(global::System.Int32);
        var k = sizeof(int) + sizeof(Point);
        var l = default(int[]); var m = default((int, int)); var n = default(List<int>?);
        var o = new int[5]; var p = new int[2, 3]; var q = new int[2][]; var r = new int[][] { new int[] { 1 }, new[] { 2 } }; var s = new int[,] { { 1, 2 }, { 3, 4 } };
        var t = new int?[2]; var u = new (int, int)[1]; var v = new List<int>[3]; var w = new int*[4];
        var x = (int[])o; var y = (int?)1; var z = (List<int>)o; var aa = (int*)p; var bb = (System.Int32)1; var cc = ((int, int))t;
        var dd = new[] { 1, 2 }; var ee = new[,] { { 1 } }; var ff = new { A = 1 }; var gg = new() { }; var hh = new List<int>(5) { 1, 2 };
    }
}
