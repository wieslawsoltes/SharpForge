class C
{
    void M()
    {
        var a = new Point { X = 1, Y = 2 };
        var b = new Point(1) { X = 1, };
        var c = new Line { Start = { X = 1, Y = 2 }, End = new Point { X = 3 } };
        var d = new List<int> { 1, 2, 3 };
        var e = new Dictionary<string, int> { { "a", 1 }, { "b", 2 } };
        var f = new Outer { Items = { 1, 2 }, Map = { { 1, "x" } }, Name = "n" };
        var g = new List<List<int>> { new List<int> { 1 }, new List<int>() };
        var h = new Point { };
        var i = new List<int>() { };
        var j = new C { A = { B = { C = 1 } } };
        var k = new T { a = b = c, d += 1 };
        var l = new T { x, y.z, f() };
        var m = new N.T<int>.U { P = 1 };
        var n = new T { { 1, 2, 3 }, { x = 1 } };
        var o = new int[] { 1, 2 };
        var p = new T { A = { 1, 2 }, B = { } };
        var q = new T { x => x, (a, b) => a, a ? b : c, a ?? b };
        M(new T { X = 1 }.X, new T { 1 }[0]);
    }
}
