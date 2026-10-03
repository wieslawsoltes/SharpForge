class Refs
{
    int store; int[] items;
    ref int First(int[] values) => ref values[0];
    ref readonly int Peek(in int value) { return ref value; }
    ref int Pick(bool b, ref int x, ref int y) => ref (b ? ref x : ref y);
    public ref int Property => ref store;
    public ref readonly int this[int i] => ref items[i];
    delegate ref int Getter(ref int x);
    void M(ref int a, out int b, in int c, int[] arr)
    {
        b = 0;
        ref int r = ref a;
        ref readonly int rr = ref c;
        ref var v = ref arr[0];
        r = ref arr[1];
        ref int cond = ref a > 0 ? ref a : ref arr[0];
        var copy = c > 0 ? ref a : ref r;
        First(arr) = 5;
        Use(ref a, out b, in c);
        Use(ref r, out var d, in arr[0]);
        Use(out int e, out _);
        Use(name: ref a, other: out b);
        foreach (ref int item in arr.AsSpan()) item++;
        foreach (ref readonly var item in arr.AsSpan()) { }
        for (ref int i = ref arr[0]; ; i = ref arr[1]) break;
        ref int Local(ref int z) => ref z;
        ref readonly int local2 = ref Peek(in c);
        Getter g = (ref int z) => ref z;
        ref int chained = ref First(arr), second = ref a;
    }
}
