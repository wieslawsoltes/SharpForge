class Interpolation
{
    void M()
    {
        var a = $"";
        var b = $"plain {x} text";
        var c = $"{x}{y}{z}";
        var d = $"{{escaped}} {x} }}{{";
        var e = $"{x,10} {y,-5:N2} {z:yyyy-MM-dd} {w,3:X}";
        var f = $"{(cond ? a : b)} {d["k"]} {f(a, b)} {new { A = 1 }.A}";
        var g = $"nested {$"inner {x + $"deep {y}"}"}";
        var h = $@"verbatim ""quoted"" {x}
second line {y:c:d}";
        var i = @$"alt {x} \n";
        var j = $"esc\t{x}\n\u0041\x41";
        var k = $"{x:\tN}";
        var l = $"{ x }{
            y + 1 // comment
        }";
        var m = $"{a::b} {global::System.Int32.MaxValue}";
        var n = $"""raw {x} and {x:N2}""";
        var o = $$"""two {single} {{x}} {{{y}}}""";
        var p = $$$"""three {{x}} {{{y,5:F1}}}""";
        var q = $"""
            multi {x}
              line {y:N1} "quoted"
            """;
        var r = $$"""
            {
              "json": {{value}}
            }
            """;
        var s = $"{x switch { 1 => "a", _ => "b" }}";
        var t = $"{(x, y)} {x?.y ?? z} {x!}";
    }
}
