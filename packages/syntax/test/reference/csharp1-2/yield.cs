using System.Collections.Generic;
class Yields
{
    IEnumerable<int> M(int n)
    {
        yield return 1;
        yield return n + 1;
        if (n > 0) yield break;
        foreach (var x in M(n - 1)) yield return x;
        yield return (n);
        while (true) { yield return n++; if (n > 9) yield break; }
    }
    void N()
    {
        int yield = 1;
        yield = 2;
        yield++;
        var y = yield + 1;
        yield(yield);
        yield.ToString();
    }
    int yield(int yield) { return yield; }
    yield Type(yield p) { yield x; yield y = p; return y; }
}
class yield { }
