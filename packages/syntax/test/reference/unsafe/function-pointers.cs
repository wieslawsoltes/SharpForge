using System.Collections.Generic;
unsafe class F
{
    delegate*<int, void> a;
    delegate* managed<int, int> b;
    delegate* unmanaged<int, int> c;
    delegate* unmanaged[Cdecl]<int, int> d;
    delegate* unmanaged[Cdecl, SuppressGCTransition]<int*, List<int>[], void> e;
    delegate*<ref int, out int, in int, ref readonly int> f;
    delegate*<delegate*<int, void>, delegate* unmanaged[Stdcall]<void>> g;
    delegate*<int, void>[] h;
    delegate*<Dictionary<string, List<int>>, (int, string), int?> i;
    delegate*<void>* j;
    void M(delegate*<int, int> p, List<delegate*<void>[]> list)
    {
        delegate*<int, int> local = p;
        var r = local(1) + p(2);
        var cast = (delegate*<void>)null;
        delegate* unmanaged<void> u = &Native;
        var t = typeof(delegate*<int>);
        var size = sizeof(delegate*<void>);
        var x = (delegate* unmanaged[Thiscall]<F*, int>)p;
    }
    static delegate*<int> Get() => null;
}
