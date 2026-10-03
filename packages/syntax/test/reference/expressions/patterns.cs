class Patterns
{
    void M(object x, int n)
    {
        var a = x is int;
        var b = x is int i;
        var c = x is string s && s.Length > 0;
        var d = x is null;
        var e = x is not null;
        var f = x is var y;
        var g = x is 42;
        var h = x is A.B;
        var i2 = x is A.B c2;
        var j = x is List<int> list;
        var k = x is int[] array;
        var l = x is int? ;
        var m = x is T ? 1 : 2;
        var m2 = x is T? ? 1 : 2;
        var n2 = x is _;
        var o = x is Color.Red or Color.Green;
        var p = x is { };
        var q = x is { } notNull;
        var r = x is { Length: 3 };
        var s2 = x is { P: 1, Q.R: var z } w;
        var t = x is T(1, var k2) { A: 2 };
        var u = x is (1, 2);
        var v = x is (int a1, string b1) tuple;
        var w2 = x is Point { X: > 0, Y: < 0 } pt;
        var x2 = x is Point(var px, _) { X: 1 };
        var y2 = x is > 0 and < 10 or not null;
        var z2 = x is not (> 0 and < 10);
        var a3 = x is int or long or short;
        var b3 = x is not int and not long;
        var c3 = x is (int or long) and not 5;
        var d3 = x is >= 'a' and <= 'z' or >= 'A' and <= 'Z';
        var e3 = x is [1, .., var last];
        var f3 = x is [.. var rest] all;
        var g3 = x is [];
        var h3 = x is [_, _, ..];
        var i3 = x is [var first, .. { Length: > 2 } middle, _];
        var j3 = x is [[1, 2], [.., 3]] nested;
        var k3 = x is (1);
        var l3 = x is (int)1;
        var m3 = x is 1 + 2;
        var n3 = x is nameof(M);
        var o3 = x is "text" or 'c' or 1.5 or true;
        var p3 = x is string { Length: var len } && len > 1;
        switch (x)
        {
            case int n4 when n4 > 0: break;
            case int: break;
            case A.B: break;
            case (1, 2): break;
            case var q4: break;
            case T t4 when t4.X: break;
            case > 5 and < 7: break;
            case null: break;
            case 1: case 2: goto default;
            case "s": goto case 1;
            case { Length: 1 } single when single.Ok: break;
            case [1, ..]: break;
            case not null: break;
            default: break;
        }
        var s3 = x switch { A => 1, int q5 => 2, { P: 1 } => 3, (1, _) => 4, > 5 => 5, [] => 6, null => 7, var other when other.Ok => 8, _ => 9, };
        var s4 = (n, x) switch { (1, string) => "a", (_, _) => "b" };
        var s5 = x switch { } ;
    }
}
