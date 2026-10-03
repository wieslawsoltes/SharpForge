using System;
class Statements
{
    unsafe void M(object o, int[] items)
    {
        ;
        { }
        int a = 1, b, c = a + 1;
        const double Pi = 3.14, Tau = Pi * 2;
        var v = new object();
        ref int r = ref a;
        ref readonly int rr = ref a;
        scoped ref int sr = ref a;
        static int Twice(int x) => x * 2;
        async Task<int> LocalAsync<T>(T value) where T : class { await Task.Yield(); return 1; }
        static extern void Native();
        if (a > 0) b = 1; else if (a < 0) b = -1; else { b = 0; }
        while (a < 10) a++;
        do { a--; } while (a > 0);
        for (int i = 0, j = 10; i < j; i++, j--) { }
        for (; ; ) break;
        for (a = 0, b = 1; ; ) { continue; }
        foreach (var item in items) Console.WriteLine(item);
        foreach (ref readonly var item in span) { }
        await foreach (var x in stream) { }
        switch (a) { case 1: case 2: b = 1; break; default: b = 2; break; }
        switch (o) { }
        lock (o) { }
        using (var d = Open()) { }
        using (Open()) using (var e = Open(), f = Open()) { }
        using var u = Open();
        await using var au = Open();
        await using (var d2 = Open()) { }
        fixed (int* p = items, q = &a) { }
        checked { a++; }
        unchecked { a--; }
        unsafe { int* ptr = &a; *ptr = 1; ptr->ToString(); }
        try { Risky(); }
        catch (InvalidOperationException ex) when (ex.Message != null) { throw; }
        catch (Exception) { throw new Exception("x"); }
        catch { }
        finally { Cleanup(); }
        try { } finally { }
        goto done;
        done: ;
        outer: inner: while (true) { goto outer; }
        yield return a;
        yield break;
        return;
    }
    int N() { return 1 + 2; }
    ref int R(ref int x) { return ref x; }
}
