using System;
using System.Collections.Generic;
using System.Linq;

public sealed class Ring
{
    private readonly int[] items;
    public Ring(params int[] items) { this.items = items; }
    public int Count => items.Length;
    public int this[int index] => items[index];
}

public static class Program
{
    static string Describe(IReadOnlyList<string> words) => words switch
    {
        [] => "none",
        [var only] => "one " + only,
        ["a", .., "z"] => "a to z over " + words.Count,
        [var first, .., { Length: > 3 } last] => first + ".." + last,
        [_, _] => "two",
        _ => "many",
    };

    static string Text(string text) => text switch
    {
        "" => "empty",
        ['#', .. var rest] => "tag " + rest,
        [.., '!'] => "shout",
        [var c] when char.IsDigit(c) => "digit " + c,
        [>= 'a' and <= 'z', .. { Length: > 2 } tail, _] => "word with " + tail,
        _ => "other",
    };

    static int Total(ReadOnlySpan<int> values) => values switch
    {
        [] => 0,
        [var head, .. var tail] => head + Total(tail),
    };

    static string Spans(Span<char> buffer) => buffer is ['x', .. var middle, 'y'] ? "x" + middle.Length + "y" : buffer is [_, _, ..] ? "long" : "short";

    static string Kind(object value) => value switch
    {
        (int a, int b) and not (0, 0) => "pair " + (a > b ? "desc" : "asc"),
        (0, 0) => "origin",
        (string name, _, _) => "triple of " + name,
        (var x, var y) => "two: " + x + "," + y,
        List<int> and [] => "empty list",
        List<int> list when list is [.., var last] => "list ending " + last,
        Ring and [1, .., 3] => "ring 1..3",
        Ring { Count: 2 } and [var a, var b] => "ring pair " + (a + b),
        int?[] and [null, ..] => "starts with null",
        _ => "something",
    };

    public static void Main()
    {
        Console.WriteLine(string.Join("; ", new[] { "", "x", "a m z", "ab cd", "ab wxyz", "a b c" }.Select(text => Describe(text.Split(' ', StringSplitOptions.RemoveEmptyEntries)))));
        Console.WriteLine(Describe(new List<string> { "a", "z" }) + "; " + string.Join("; ", new[] { "", "#tag", "Hey!", "7", "hello", "Ab", "ab" }.Select(Text)));
        Console.WriteLine(Total(new[] { 1, 2, 3, 4 }) + " " + Total(default) + " " + Spans("xabcy".ToCharArray()) + " " + Spans("ab".ToCharArray()) + " " + Spans(new char[1]));
        object[] values = { (2, 1), (1, 2), (0, 0), ("n", 1, 2.5), (1.5, "s"), new List<int>(), new List<int> { 4, 9 }, new Ring(1, 2, 3), new Ring(5, 6), new Ring(), new int?[] { null, 1 }, "text", (1, 2, 3, 4) };
        Console.WriteLine(string.Join("; ", values.Select(Kind)));
        int?[] maybe = { 1, null };
        (int, int)? pair = (3, 4);
        Console.WriteLine((maybe is [1, null]) + " " + (maybe is [.., not null]) + " " + (pair is (3, var four) ? four : -1) + " " + ("hi" is [var h, 'i'] && h == 'h') + " " + (new Ring(7) is [7]));
    }
}
