using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

public enum TokenKind { Number, Identifier, Text, Operator, LParen, RParen, Comma, End }

public readonly record struct Token(TokenKind Kind, string Value, int Position)
{
    public override string ToString() => Kind == TokenKind.End ? "<end>" : Kind == TokenKind.Text ? "'" + Value + "'" : Value;
}

public sealed class Tokenizer : IEnumerable<Token>
{
    private readonly string source;
    public int Enumerations { get; private set; }
    public Tokenizer(string source) { this.source = source ?? throw new ArgumentNullException(nameof(source)); }

    public IEnumerator<Token> GetEnumerator()
    {
        Enumerations++;
        int i = 0;
        while (i < source.Length)
        {
            char c = source[i];
            int start = i;
            switch (c)
            {
                case '\t': goto case ' ';
                case ' ': i++; continue;
                case '(': yield return new Token(TokenKind.LParen, "(", i++); break;
                case ')': yield return new Token(TokenKind.RParen, ")", i++); break;
                case ',': yield return new Token(TokenKind.Comma, ",", i++); break;
                case '"':
                {
                    var text = new StringBuilder();
                    for (i++; ; i++)
                    {
                        if (i >= source.Length) throw new FormatException("unterminated string at " + start);
                        if (source[i] == '"') break;
                        if (source[i] == '\\' && i + 1 < source.Length) i++;
                        text.Append(source[i]);
                    }
                    i++;
                    yield return new Token(TokenKind.Text, text.ToString(), start);
                    break;
                }
                case >= '0' and <= '9':
                    while (i < source.Length && (char.IsDigit(source[i]) || source[i] == '.')) i++;
                    yield return new Token(TokenKind.Number, source.Substring(start, i - start), start);
                    break;
                case '_':
                case var letter when char.IsLetter(letter):
                    while (i < source.Length && (char.IsLetterOrDigit(source[i]) || source[i] == '_')) i++;
                    yield return new Token(TokenKind.Identifier, source[start..i], start);
                    break;
                case '<' or '>' or '=' or '!' when i + 1 < source.Length && source[i + 1] == '=':
                    i += 2;
                    yield return new Token(TokenKind.Operator, source.Substring(start, 2), start);
                    break;
                case '+' or '-' or '*' or '/' or '<' or '>':
                    yield return new Token(TokenKind.Operator, c.ToString(), i++);
                    break;
                default:
                    throw new FormatException("unexpected '" + c + "' at " + i);
            }
        }
        yield return new Token(TokenKind.End, "", source.Length);
    }

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

public static class Expressions
{
    private static readonly HashSet<string> Functions = new HashSet<string> { "max", "min", "len" };

    private static int Precedence(string op) => op switch { "*" or "/" => 3, "+" or "-" => 2, _ => 1 };

    public static IEnumerable<Token> ToPostfix(IEnumerable<Token> tokens)
    {
        ArgumentNullException.ThrowIfNull(tokens);
        return Core();

        IEnumerable<Token> Core()
        {
            var pending = new Stack<Token>();
            foreach (Token token in tokens)
            {
                switch (token.Kind)
                {
                    case TokenKind.Number:
                    case TokenKind.Text:
                        yield return token;
                        break;
                    case TokenKind.Identifier:
                        if (Functions.Contains(token.Value)) pending.Push(token);
                        else yield return token;
                        break;
                    case TokenKind.Operator:
                        while (pending.Count > 0 && pending.Peek().Kind == TokenKind.Operator && Precedence(pending.Peek().Value) >= Precedence(token.Value)) yield return pending.Pop();
                        pending.Push(token);
                        break;
                    case TokenKind.LParen:
                        pending.Push(token);
                        break;
                    case TokenKind.Comma:
                        while (pending.Peek().Kind != TokenKind.LParen) yield return pending.Pop();
                        break;
                    case TokenKind.RParen:
                        while (pending.Peek().Kind != TokenKind.LParen) yield return pending.Pop();
                        pending.Pop();
                        if (pending.Count > 0 && pending.Peek().Kind == TokenKind.Identifier) yield return pending.Pop();
                        break;
                    case TokenKind.End:
                        while (pending.Count > 0) yield return pending.Pop();
                        yield break;
                }
            }
        }
    }

    public static double Evaluate(IEnumerable<Token> postfix, IReadOnlyDictionary<string, double> variables)
    {
        var stack = new Stack<object>();
        double Pop() => (double)stack.Pop();
        foreach (Token token in postfix)
        {
            switch (token)
            {
                case { Kind: TokenKind.Number }: stack.Push(double.Parse(token.Value, CultureInfo.InvariantCulture)); break;
                case { Kind: TokenKind.Text }: stack.Push(token.Value); break;
                case { Kind: TokenKind.Identifier, Value: "len" }: stack.Push((double)((string)stack.Pop()).Length); break;
                case { Kind: TokenKind.Identifier, Value: "max" }: stack.Push(Math.Max(Pop(), Pop())); break;
                case { Kind: TokenKind.Identifier, Value: "min" }: stack.Push(Math.Min(Pop(), Pop())); break;
                case { Kind: TokenKind.Identifier }: stack.Push(variables[token.Value]); break;
                default:
                    double right = Pop(), left = Pop();
                    stack.Push(token.Value switch
                    {
                        "+" => left + right, "-" => left - right, "*" => left * right, "/" => left / right,
                        "<" => left < right ? 1.0 : 0.0, ">" => left > right ? 1.0 : 0.0, "<=" => left <= right ? 1.0 : 0.0,
                        ">=" => left >= right ? 1.0 : 0.0, "==" => left == right ? 1.0 : 0.0, "!=" => left != right ? 1.0 : 0.0,
                        _ => throw new NotSupportedException("operator " + token.Value),
                    });
                    break;
            }
        }
        return Pop();
    }
}

public static class Program
{
    public static void Main()
    {
        var variables = new Dictionary<string, double> { ["width"] = 4, ["height"] = 2.5, ["_pad"] = 1 };
        var first = new Tokenizer("max(width * 2, 3) + len(\"a \\\"q\\\" b\")\t/ height");
        Console.WriteLine(string.Join(" ", first.Select(t => t.Kind.ToString()[0] + ":" + t + "@" + t.Position)));
        Console.WriteLine("count=" + first.Count() + " enumerations=" + first.Enumerations);

        string[] sources = { "1 + 2 * 3", "(1 + 2) * 3", "width * height - _pad", "min(10, max(2, 3) * 4) / 8", "1 + 2 <= 3 * 1", "len(\"hello\") != 5", "10 - 4 - 3", "2 * (3 + 4) * 5 >= 70" };
        foreach (string source in sources)
        {
            IEnumerable<Token> postfix = Expressions.ToPostfix(new Tokenizer(source));
            Console.WriteLine(source.PadRight(28) + "=> " + string.Join(" ", postfix).PadRight(26) + "= " + Expressions.Evaluate(postfix, variables).ToString("0.###", CultureInfo.InvariantCulture));
        }

        foreach (string broken in new[] { "1 + $", "\"open", "(1 + 2", "1 + 2)", "1 +", "width % 2", "depth + 1" })
        {
            var seen = new List<string>();
            try
            {
                foreach (Token token in new Tokenizer(broken)) seen.Add(token.ToString());
                Console.WriteLine(broken.PadRight(10) + "tokens ok; value " + Expressions.Evaluate(Expressions.ToPostfix(new Tokenizer(broken)), variables));
            }
            catch (FormatException e) { Console.WriteLine(broken.PadRight(10) + "lexer: " + e.Message + " (after " + seen.Count + " tokens)"); }
            catch (Exception e) when (e is InvalidOperationException or KeyNotFoundException or InvalidCastException) { Console.WriteLine(broken.PadRight(10) + "parser: " + e.GetType().Name); }
        }

        try { Expressions.ToPostfix(null); }
        catch (ArgumentNullException e) { Console.WriteLine("eager validation: " + e.ParamName); }
        IEnumerable<Token> deferred = Expressions.ToPostfix(new Tokenizer("2 * ?"));
        Console.WriteLine("deferred failure: built without error, first=" + deferred.First());

        var tokenizer = new Tokenizer("a + 1");
        IEnumerator<Token> manual = tokenizer.GetEnumerator();
        Console.WriteLine("before MoveNext enumerations=" + tokenizer.Enumerations);
        var driven = new List<string>();
        while (manual.MoveNext()) driven.Add(manual.Current.Kind + "@" + manual.Current.Position);
        Console.WriteLine(string.Join(" ", driven) + " | MoveNext after end=" + manual.MoveNext() + " enumerations=" + tokenizer.Enumerations);
        try { manual.Reset(); }
        catch (NotSupportedException) { Console.WriteLine("Reset: NotSupportedException"); }
        manual.Dispose();

        int kinds = 0;
        foreach (object boxed in (IEnumerable)tokenizer) if (boxed is Token { Kind: TokenKind.Identifier or TokenKind.Number }) kinds++;
        Console.WriteLine("non-generic enumeration found " + kinds + " operands, enumerations=" + tokenizer.Enumerations);
    }
}
