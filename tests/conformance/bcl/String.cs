static partial class Oracle
{
    public static void Main()
    {
        Begin("string");
        Case("string-empty-length", () => "".Length);
        Case("string-surrogate-length", () => "A😀Z".Length);
        Case("string-concat-null", () => string.Concat("left", null, "right"));
        Case("string-concat-objects", () => string.Concat(new object[] { "a", 42, true }));
        Case("string-null-or-empty", () => string.IsNullOrEmpty(null));
        Case("string-whitespace-nbsp", () => string.IsNullOrWhiteSpace(" \t\u00a0"));
        Case("string-ordinal-equal", () => string.Equals("Sharp", "Sharp", StringComparison.Ordinal));
        Case("string-ordinal-ignore-case", () => string.Equals("sharP", "SHARP", StringComparison.OrdinalIgnoreCase));
        Case("string-ordinal-compare", () => Math.Sign(string.Compare("alpha", "beta", StringComparison.Ordinal)));
        Case("string-substring-middle", () => "abcdef".Substring(2, 3));
        Case("string-substring-at-end", () => "abc".Substring(3, 0));
        Case("string-substring-negative", () => "abc".Substring(-1));
        Case("string-substring-overrun", () => "abc".Substring(2, 2));
        Case("string-index-found", () => "ababa".IndexOf("ba", StringComparison.Ordinal));
        Case("string-index-missing", () => "ababa".IndexOf("z", StringComparison.Ordinal));
        Case("string-index-offset", () => "ababa".IndexOf("ba", 2, StringComparison.Ordinal));
        Case("string-last-index", () => "ababa".LastIndexOf("ba", StringComparison.Ordinal));
        Case("string-starts-with", () => "prefix-value".StartsWith("prefix", StringComparison.Ordinal));
        Case("string-ends-with", () => "value-suffix".EndsWith("suffix", StringComparison.Ordinal));
        Case("string-contains-empty", () => "abc".Contains("", StringComparison.Ordinal));
        Case("string-replace-text", () => "a-b-a".Replace("a", "xy", StringComparison.Ordinal));
        Case("string-replace-char", () => "banana".Replace('a', 'o'));
        Case("string-replace-empty-old", () => "abc".Replace("", "x"));
        Case("string-split-empty", () => string.Join("|", "a,,b,".Split(',')));
        Case("string-split-remove-empty", () => string.Join("|", "a,,b,".Split(',', StringSplitOptions.RemoveEmptyEntries)));
        Case("string-split-trim", () => string.Join("|", " a , , b ".Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)));
        Case("string-join-null-element", () => string.Join("|", new string[] { "a", null, "b" }));
        Case("string-pad-left", () => "42".PadLeft(5, '0'));
        Case("string-pad-right", () => "x".PadRight(4, '.'));
        Case("string-pad-negative", () => "x".PadLeft(-1));
        Case("string-trim-whitespace", () => " \t hello \r\n".Trim());
        Case("string-trim-characters", () => "..text..".Trim('.'));
        Case("string-insert-middle", () => "abcd".Insert(2, "XY"));
        Case("string-remove-middle", () => "abcdef".Remove(2, 3));
        Case("string-remove-at-end", () => "abc".Remove(3, 0));
        Case("string-char-array", () => string.Join("|", "abc".ToCharArray()));
        Case("string-normalize-composed", () => "e\u0301".Normalize(NormalizationForm.FormC));
        Case("string-upper-invariant", () => "SharpForge".ToUpperInvariant());
        Case("string-lower-culture", () => "ÉCOLE".ToLower(CultureInfo.CurrentCulture));
        Case("string-char-index-outside", () => "abc"[3]);
    }
}
