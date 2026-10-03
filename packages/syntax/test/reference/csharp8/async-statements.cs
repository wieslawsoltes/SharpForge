using System.Threading.Tasks;
class C
{
    async Task M()
    {
        await foreach (var x in xs) { }
        await foreach (int y in xs) F(y);
        await foreach (var (a, b) in pairs) { }
        await foreach ((int c, int d) in pairs) { }
        await foreach (var z in xs.WithCancellation(token).ConfigureAwait(false)) { }
        await using (var r = F()) { }
        await using (F()) { }
        await using (R r1 = F(), r2 = G()) { }
        await using var s = F();
        await using R t = F(), u = G();
        using var v = F();
        using R w = F(), w2 = G();
        using (var q = F()) { }
        using (F()) { }
        using var _ = F();
        using (var a1 = F())
        using (var a2 = F())
        { }
        await using (var b1 = F())
        await using (var b2 = F())
        { }
        foreach (var e in xs) await using (var f = F()) { }
        label: await foreach (var g in xs) { }
        if (c) await using (F()) { } else await foreach (var h in xs) { }
        await foreach (ref var i in xs) { }
        await foreach (ref readonly var j in xs) { }
        using ref var k = ref F();
        using scoped var l = F();
        await F();
    }
    async System.Collections.Generic.IAsyncEnumerable<int> Iter()
    {
        yield return 1;
        await Task.Delay(1);
        yield return await G();
        yield break;
    }
    void N()
    {
        using var a = F();
        using (var b = F()) { }
        int await = 1;
        int using1 = 2;
    }
}
