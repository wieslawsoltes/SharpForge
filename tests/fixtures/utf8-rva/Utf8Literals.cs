using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;

public static class Utf8Literals
{
    public static ReadOnlySpan<byte> Empty() => ""u8;
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static ReadOnlySpan<byte> Ascii() => "SharpForge"u8;
    public static ReadOnlySpan<byte> Duplicate() => "SharpForge"u8;
    public static ReadOnlySpan<byte> Unicode() => "héλ😀"u8;
    public static ReadOnlySpan<byte> Embedded() => "\0A\0ÿ\0"u8;
    public static ReadOnlySpan<byte> Concatenated() => ("hé"u8 + "λ"u8) + "😀"u8;
    public static ReadOnlySpan<byte> Raw() => """
        first "quoted"
        second 😀
        """u8;
    public static ReadOnlySpan<byte> One() => "a"u8;
    public static ReadOnlySpan<byte> Three() => "abc"u8;
    public static ReadOnlySpan<byte> Seven() => "abcdefg"u8;
    public static ReadOnlySpan<byte> Eight() => "abcdefgh"u8;
    public static ReadOnlySpan<byte> Generic<T>() => "generic"u8;
    public static int Local()
    {
        ReadOnlySpan<byte> Text() => "local"u8;
        return Text()[1];
    }
    public static int Initializer = "field"u8[1];
    public static int StackOperand() => Sum("stack"u8, stackalloc byte[] { 4, 5 });
    private static int Sum(ReadOnlySpan<byte> text, Span<byte> stack) => text.Length + stack.Length;
    public static IEnumerable<int> Iterator()
    {
        yield return "iter"u8[0];
        yield return "😀"u8.Length;
    }
}

public class Utf8Base
{
    public int Value;
    protected Utf8Base(ReadOnlySpan<byte> text) { Value = text[0]; }
}

public sealed class Utf8Constructor : Utf8Base
{
    public Utf8Constructor() : base("base"u8) { }
}
