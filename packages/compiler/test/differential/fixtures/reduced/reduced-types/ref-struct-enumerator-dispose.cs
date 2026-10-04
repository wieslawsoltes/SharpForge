using System;

// Reduced from stress-spans/in-place-tokenizer: `foreach` over a ref struct enumerator calls its `Dispose()` by pattern
// (a ref struct cannot implement IDisposable).

string source = "ab cd  efg";
Span<char> buffer = stackalloc char[source.Length];
source.AsSpan().CopyTo(buffer);
Console.WriteLine("begin");
foreach (var token in new Tokenizer(buffer))
{
    Console.WriteLine(token.Offset + " " + token.Text.ToString());
}
Console.WriteLine("disposals=" + Tokenizer.Disposals);

public readonly ref struct Token
{
    public Token(ReadOnlySpan<char> text, int offset) { Text = text; Offset = offset; }
    public ReadOnlySpan<char> Text { get; }
    public int Offset { get; }
}

public ref struct Tokenizer
{
    public static int Disposals;
    private ReadOnlySpan<char> _rest;
    private int _offset;
    private Token _current;

    public Tokenizer(ReadOnlySpan<char> text)
    {
        _rest = text;
        _offset = 0;
        _current = default;
    }

    public readonly Token Current => _current;
    public readonly Tokenizer GetEnumerator() => this;
    public void Dispose() { Disposals++; _rest = default; }

    public bool MoveNext()
    {
        var text = _rest.TrimStart();
        _offset += _rest.Length - text.Length;
        _rest = text;
        if (text.IsEmpty) return false;
        int length = 1;
        while (length < text.Length && text[length] != ' ') length++;
        _current = new Token(text[..length], _offset);
        _rest = text[length..];
        _offset += length;
        return true;
    }
}
