using System;

// Reduced from stress-spans/in-place-tokenizer: a span of characters matched against string constants, alone and
// combined with `or`, `and`, `not`, in `is` and in switch expressions.
public static class Program
{
    private static int Width(ReadOnlySpan<char> text) =>
        text.Length >= 2 && text[..2] is "==" or "<=" or ">=" or "!=" or "&&" ? 2 : 1;

    private static string Classify(ReadOnlySpan<char> word) => word switch
    {
        "if" or "else" => "branch",
        "let" => "binding",
        not "" and not "x" when word.Length < 3 => "short",
        "" => "empty",
        _ => "other",
    };

    private static bool IsUnit(Span<char> text) => text is "px" or "em";

    public static void Main()
    {
        foreach (string sample in new[] { "== 1", "<=", "=", "&& b", "a+b", "!" })
        {
            Console.WriteLine(sample + " -> " + Width(sample));
        }
        foreach (string word in new[] { "if", "else", "let", "ab", "x", "", "longer" })
        {
            Console.WriteLine("'" + word + "' " + Classify(word) + " " + (word.AsSpan() is "let") + " " + (word.AsSpan() is not "if"));
        }
        Span<char> unit = stackalloc char[] { 'e', 'm' };
        Console.WriteLine(IsUnit(unit) + " " + IsUnit(stackalloc char[] { 'p', 't' }));
    }
}
