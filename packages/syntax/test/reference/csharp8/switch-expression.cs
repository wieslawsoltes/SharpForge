class C
{
    int M(object o, int i, (int, int) t)
    {
        var a = o switch { int n => n, string s => s.Length, _ => 0 };
        var b = o switch { int n when n > 0 => 1, int n when n < 0 => -1, _ => 0, };
        var c = i switch { 1 => "one", 2 => "two", _ => "many" };
        var d = t switch { (0, 0) => 0, (var x, 0) => x, (0, var y) => y, _ => -1 };
        var e = o switch { null => 0, { } => 1 };
        var f = o switch { Point { X: 0, Y: var y } => y, Point(var x, _) => x, _ => 0 };
        var g = i switch { > 0 and < 10 => 1, >= 10 or <= -10 => 2, not 0 => 3, _ => 4 };
        var h = o switch { };
        var j = i + 1 switch { 2 => true, _ => false };
        var k = (i + 1) switch { 2 => true, _ => false };
        var l = i switch { 1 => 2 } switch { 2 => 3 };
        var m = -i switch { 1 => 2, _ => 3 };
        var n = i switch { 1 => 2, _ => 3 } + 1;
        var p = a ? b : i switch { 1 => 2, _ => 3 };
        var q = i switch { 1 => x => x, _ => y => y };
        var r = i switch { 1 => throw new E(), _ => 0 };
        var s = await i switch { 1 => 2, _ => 3 };
        var u = i switch { 1 => a ? b : c, _ => a ?? b };
        var v = i == 1 switch { true => 1, _ => 0 };
        var w = i..j switch { _ => 1 };
        var x1 = i as int? switch { null => 0, _ => 1 };
        var y1 = (o, i) switch { (int _, 1) => 1, (string { Length: > 1 }, _) => 2, _ => 3 };
        var z1 = o switch { int[] { Length: 1 } arr => arr[0], System.Collections.Generic.List<int> list => list.Count, _ => 0 };
        var b2 = i switch { 1 or 2 => 1, (3) => 2, (> 4) and (< 5) => 3, _ => 4 };
        var c2 = o switch { var z => z };
        var d2 = o switch { A.B => 1, A.C<int> => 2, global::A.D => 3, _ => 4 };
        var e2 = i switch { 1 + 2 => 1, (int)3 => 2, -4 => 3, _ => 4 };
        var f2 = o switch { [1, .., 2] => 1, [] => 2, [var first, .. var rest] => 3, _ => 4 };
        return i switch { 1 => 2, _ => 3 };
    }
    int P => x switch { 1 => 2, _ => 3 };
    int switchCase = y switch
    {
        1 => 2,
        _ => 3
    };
}
