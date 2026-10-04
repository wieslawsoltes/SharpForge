using System;
using System.Collections.Generic;
using System.Globalization;

string source = "  let total = price * (qty + 12) - 0x1F ;  if total >= 100 && ok   // apply discount ";
Span<char> buffer = source.Length <= 128 ? stackalloc char[source.Length] : new char[source.Length];
source.AsSpan().CopyTo(buffer);

var kinds = new SortedDictionary<TokenKind, int>();
int numbers = 0;
foreach (var token in new Tokenizer(buffer))
{
    kinds[token.Kind] = kinds.GetValueOrDefault(token.Kind) + 1;
    if (token.Kind == TokenKind.Number) numbers += Scanner.ParseNumber(token.Text);
    if (token.Kind == TokenKind.Identifier && Scanner.IsKeyword(token.Text))
        foreach (ref char c in buffer.Slice(token.Offset, token.Text.Length)) c = char.ToUpperInvariant(c);
    Console.WriteLine($"{token.Offset,3} {token.Kind,-10} '{token.Text.ToString()}'");
}
Console.WriteLine(string.Join(" ", kinds) + " sum=" + numbers + " disposals=" + Tokenizer.Disposals);

int compacted = Scanner.Compact(buffer);
Console.WriteLine("[" + buffer[..compacted].ToString() + "] " + compacted + " of " + buffer.Length);
buffer[compacted..].Fill('.');
Console.WriteLine(buffer[^12..].ToString() + " " + buffer.IndexOf("IF") + " " + buffer.LastIndexOf('=') + " " + buffer[..compacted].Contains('(')
    + " " + buffer.StartsWith("LET ") + " " + buffer[..compacted].EndsWith("discount") + " " + buffer.IndexOfAny('<', '>', '!'));

using (var manual = new Tokenizer("a+b == c"))
{
    var cursor = manual;
    var texts = new List<string>();
    while (cursor.MoveNext()) texts.Add(cursor.Current.Text.ToString());
    Console.WriteLine(string.Join("|", texts) + " " + cursor.Count + " " + manual.Count + " disposals=" + Tokenizer.Disposals);
}
Console.WriteLine("disposals=" + Tokenizer.Disposals);

ReadOnlySpan<char> line = "name= Ada Lovelace ; age = 36;; city=  London  ;flag; =x";
Span<Range> fields = stackalloc Range[8];
int fieldCount = line.Split(fields, ';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
for (int i = 0; i < fieldCount; i++)
{
    var field = line[fields[i]];
    int equals = field.IndexOf('=');
    var key = equals < 0 ? field : field[..equals].TrimEnd();
    ReadOnlySpan<char> value = equals < 0 ? default : field[(equals + 1)..].TrimStart();
    Console.WriteLine($"{i}: {(key.IsEmpty ? "<none>" : key.ToString())} -> {(value.IsEmpty ? "<none>" : value.ToString())} @{fields[i]}");
}

Span<char> sentence = stackalloc char[] { 't', 'h', 'e', ' ', 'q', 'u', 'i', 'c', 'k', ' ', 'f', 'o', 'x' };
Scanner.ReverseWords(sentence);
Console.WriteLine(sentence.ToString() + " " + sentence.SequenceEqual("fox quick the") + " " + sentence[4..9].SequenceEqual("quick".AsSpan()) + " " + Scanner.CountWords("  a bb   ccc d "));
Console.WriteLine(Scanner.ParseNumber("0xff") + " " + Scanner.ParseNumber("0042") + " " + Scanner.Longest("alpha beta gamma delta epsilon z").ToString()
    + " " + Scanner.Longest("").Length + " " + "  padded\t".AsSpan().Trim().Length + " " + "xxhixx".AsSpan().Trim('x').ToString() + " " + "a,b".AsSpan().TrimEnd("b,").ToString());

public enum TokenKind { Identifier, Number, Symbol, Comment }

public readonly ref struct Token
{
    public Token(TokenKind kind, ReadOnlySpan<char> text, int offset) { Kind = kind; Text = text; Offset = offset; }
    public TokenKind Kind { get; }
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
        Count = 0;
    }

    public int Count { get; private set; }
    public readonly Token Current => _current;
    public readonly Tokenizer GetEnumerator() => this;
    public void Dispose() { Disposals++; _rest = default; }

    public bool MoveNext()
    {
        var text = _rest.TrimStart();
        _offset += _rest.Length - text.Length;
        _rest = text;
        if (text.IsEmpty) return false;
        TokenKind kind;
        int length;
        if (text.StartsWith("//"))
        {
            kind = TokenKind.Comment;
            length = text.TrimEnd().Length;
        }
        else if (char.IsLetter(text[0]) || text[0] == '_')
        {
            kind = TokenKind.Identifier;
            length = 1;
            while (length < text.Length && (char.IsLetterOrDigit(text[length]) || text[length] == '_')) length++;
        }
        else if (char.IsDigit(text[0]))
        {
            kind = TokenKind.Number;
            int prefix = text.StartsWith("0x") ? 2 : 0;
            int end = text[prefix..].IndexOfAnyExcept(prefix == 2 ? "0123456789abcdefABCDEF" : "0123456789");
            length = end < 0 ? text.Length : prefix + end;
        }
        else
        {
            kind = TokenKind.Symbol;
            length = text.Length >= 2 && text[..2] is "==" or "<=" or ">=" or "!=" or "&&" ? 2 : 1;
        }
        _current = new Token(kind, text[..length], _offset);
        _rest = text[length..];
        _offset += length;
        Count++;
        return true;
    }
}

public static class Scanner
{
    public static bool IsKeyword(ReadOnlySpan<char> word) => word is "let" or "if" or "else" or "while";

    public static int ParseNumber(ReadOnlySpan<char> text) => text.StartsWith("0x")
        ? int.Parse(text[2..], NumberStyles.HexNumber, CultureInfo.InvariantCulture)
        : int.Parse(text, NumberStyles.None, CultureInfo.InvariantCulture);

    public static int Compact(Span<char> buffer)
    {
        int write = 0;
        foreach (var token in new Tokenizer(buffer))
        {
            if (write > 0) buffer[write++] = ' ';
            token.Text.CopyTo(buffer[write..]);
            write += token.Text.Length;
        }
        return write;
    }

    public static void ReverseWords(Span<char> text)
    {
        text.Reverse();
        int start = 0;
        while (start < text.Length)
        {
            int space = text[start..].IndexOf(' ');
            int end = space < 0 ? text.Length : start + space;
            text[start..end].Reverse();
            start = end + 1;
        }
    }

    public static int CountWords(ReadOnlySpan<char> text)
    {
        int count = 0;
        foreach (var range in text.Split(' '))
            if (!text[range].IsEmpty) count++;
        return count;
    }

    public static ReadOnlySpan<char> Longest(ReadOnlySpan<char> text)
    {
        ReadOnlySpan<char> best = default;
        foreach (var range in text.Split(' '))
        {
            var word = text[range];
            if (word.Length > best.Length) best = word;
        }
        return best;
    }
}
