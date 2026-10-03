using System;
class S
{
    unsafe void M(int n)
    {
        int* a = stackalloc int[n];
        Span<int> b = stackalloc int[3];
        Span<int> c = stackalloc int[] { 1, 2, 3 };
        Span<int> d = stackalloc int[3] { 1, 2, 3 };
        Span<int> e = stackalloc[] { 1, 2, 3 };
        var f = stackalloc byte[n * 2];
        Use(stackalloc int[2]);
        Span<int> g = n > 0 ? stackalloc int[n] : stackalloc int[1];
        int h = (stackalloc int[4]).Length + M2(stackalloc[] { 1 });
        ReadOnlySpan<char> t = stackalloc char[] { 'a' };
        Span<Guid> u = stackalloc Guid[2];
        var w = stackalloc int*[2];
        Span<int> empty = stackalloc int[0] { };
    }
}
