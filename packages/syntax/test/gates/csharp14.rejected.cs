// langversion 13: expect the language-version diagnostics recorded in the .roslyn.json beside this file
using System;
using System.Collections.Generic;
delegate bool TryParse(string text, out int result);
delegate int RefFunc(ref int x);
class C
{
    public int b;
    public C c;
    public event Action E;
    public int A { get => field; set => field = value; }
    public int B { get { return field; } }
    public int G => field;
    void M(C a, Action handler)
    {
        a?.b = 1;
        a?.c.b = 2;
        a?.b += 1;
        a?.c?.b = 3;
        a?.E += handler;
        var n1 = nameof(List<>);
        var n2 = nameof(Dictionary<,>);
        var n3 = nameof(List<>.Count);
        var n7 = nameof(List<int>);
        TryParse parse = (text, out result) => int.TryParse(text, out result);
        RefFunc l1 = (ref x) => x;
    }
}
