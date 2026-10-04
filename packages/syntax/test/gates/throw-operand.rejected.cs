// langversion 7: expect the language-version diagnostics recorded in the .roslyn.json beside this file
class C
{
    int M(int a, System.Exception e, bool b, object o)
    {
        var s = a + throw e;
        var t = a * throw new System.Exception("x") + 1;
        var u = b && throw e;
        var v = -throw e;
        var w = a == throw e ?? 1;
        var x = (int)throw e;
        var y = a + throw
            e;
        var z = a - throw e.InnerException.InnerException;
        var k = a + (b ? 1 : throw e);
        return o as string ?? throw e;
    }
}
