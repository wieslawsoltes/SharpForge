using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

public abstract class Json
{
    public static readonly Json Null = new JsonNull();
    public static implicit operator Json(string value) => value == null ? Null : new JsonString(value);
    public static implicit operator Json(double value) => new JsonNumber(value);
    public static implicit operator Json(bool value) => new JsonBool(value);
    public abstract void Write(StringBuilder output, int indent, int level);
    public virtual Json this[string key] => throw new InvalidOperationException("not an object");
    public virtual Json this[int index] => throw new InvalidOperationException("not an array");
    public string ToText(int indent = 0) { var output = new StringBuilder(); Write(output, indent, 0); return output.ToString(); }
    protected static void NewLine(StringBuilder output, int indent, int level) { if (indent > 0) output.Append('\n').Append(' ', indent * level); }
}

public sealed class JsonNull : Json { public override void Write(StringBuilder output, int indent, int level) => output.Append("null"); }
public sealed class JsonBool : Json
{
    public JsonBool(bool value) { Value = value; }
    public bool Value { get; }
    public override void Write(StringBuilder output, int indent, int level) => output.Append(Value ? "true" : "false");
}
public sealed class JsonNumber : Json
{
    public JsonNumber(double value) { Value = value; }
    public double Value { get; }
    public override void Write(StringBuilder output, int indent, int level) => output.Append(Value.ToString("R", CultureInfo.InvariantCulture));
}
public sealed class JsonString : Json
{
    public JsonString(string value) { Value = value; }
    public string Value { get; }
    public override void Write(StringBuilder output, int indent, int level) => Quote(output, Value);
    public static void Quote(StringBuilder output, string text)
    {
        output.Append('"');
        foreach (char c in text)
        {
            switch (c)
            {
                case '"': output.Append("\\\""); break;
                case '\\': output.Append("\\\\"); break;
                case '\n': output.Append("\\n"); break;
                case '\t': output.Append("\\t"); break;
                case < ' ': output.Append("\\u").Append(((int)c).ToString("x4")); break;
                default: output.Append(c); break;
            }
        }
        output.Append('"');
    }
}
public sealed class JsonArray : Json, IEnumerable<Json>
{
    private readonly List<Json> items = new List<Json>();
    public void Add(Json item) => items.Add(item ?? Null);
    public int Count => items.Count;
    public override Json this[int index] => items[index];
    public IEnumerator<Json> GetEnumerator() => items.GetEnumerator();
    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
    public override void Write(StringBuilder output, int indent, int level)
    {
        output.Append('[');
        for (int i = 0; i < items.Count; i++)
        {
            if (i > 0) output.Append(',');
            NewLine(output, indent, level + 1);
            items[i].Write(output, indent, level + 1);
        }
        if (items.Count > 0) NewLine(output, indent, level);
        output.Append(']');
    }
}
public sealed class JsonObject : Json, IEnumerable<KeyValuePair<string, Json>>
{
    private readonly List<KeyValuePair<string, Json>> members = new List<KeyValuePair<string, Json>>();
    public void Add(string key, Json value) => members.Add(new KeyValuePair<string, Json>(key, value ?? Null));
    public override Json this[string key] => members.FirstOrDefault(m => m.Key == key).Value ?? Null;
    public IEnumerator<KeyValuePair<string, Json>> GetEnumerator() => members.GetEnumerator();
    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
    public override void Write(StringBuilder output, int indent, int level)
    {
        output.Append('{');
        bool first = true;
        foreach (var (key, value) in members)
        {
            if (!first) output.Append(',');
            first = false;
            NewLine(output, indent, level + 1);
            JsonString.Quote(output, key);
            output.Append(indent > 0 ? ": " : ":");
            value.Write(output, indent, level + 1);
        }
        if (!first) NewLine(output, indent, level);
        output.Append('}');
    }
}

public ref struct JsonReader
{
    private ReadOnlySpan<char> text;
    private int position;
    public JsonReader(ReadOnlySpan<char> text) { this.text = text; position = 0; }

    private void Skip() { while (position < text.Length && char.IsWhiteSpace(text[position])) position++; }
    private FormatException Error(string what) => new FormatException(what + " at " + position);
    private void Expect(char c) { Skip(); if (position >= text.Length || text[position] != c) throw Error("expected '" + c + "'"); position++; }
    private bool TryLiteral(string literal)
    {
        if (!text.Slice(position).StartsWith(literal)) return false;
        position += literal.Length;
        return true;
    }

    public Json Read()
    {
        var value = ReadValue();
        Skip();
        return position == text.Length ? value : throw Error("trailing characters");
    }

    private Json ReadValue()
    {
        Skip();
        if (position >= text.Length) throw Error("unexpected end");
        switch (text[position])
        {
            case '{':
                position++;
                var result = new JsonObject();
                Skip();
                if (text[position] == '}') { position++; return result; }
                do { Skip(); string key = ReadString(); Expect(':'); result.Add(key, ReadValue()); Skip(); } while (text[position++] == ',');
                return text[position - 1] == '}' ? result : throw Error("expected '}'");
            case '[':
                position++;
                var array = new JsonArray();
                Skip();
                if (text[position] == ']') { position++; return array; }
                do { array.Add(ReadValue()); Skip(); } while (text[position++] == ',');
                return text[position - 1] == ']' ? array : throw Error("expected ']'");
            case '"': return ReadString();
            case 't' when TryLiteral("true"): return true;
            case 'f' when TryLiteral("false"): return false;
            case 'n' when TryLiteral("null"): return Json.Null;
            default:
                int start = position;
                while (position < text.Length && (char.IsDigit(text[position]) || "+-.eE".Contains(text[position]))) position++;
                return double.TryParse(text.Slice(start, position - start), NumberStyles.Float, CultureInfo.InvariantCulture, out double number) ? number : throw Error("bad token");
        }
    }

    private string ReadString()
    {
        Expect('"');
        var builder = new StringBuilder();
        while (text[position] != '"')
        {
            char c = text[position++];
            if (c != '\\') { builder.Append(c); continue; }
            c = text[position++];
            builder.Append(c switch { 'n' => '\n', 't' => '\t', 'u' => (char)int.Parse(text.Slice((position += 4) - 4, 4), NumberStyles.HexNumber), _ => c });
        }
        position++;
        return builder.ToString();
    }
}

public static class Program
{
    public static void Main()
    {
        var document = new JsonObject
        {
            { "name", "Sharp \"Forge\"" }, { "version", 1.5 }, { "stable", false }, { "license", (string)null },
            { "tags", new JsonArray { "c#", "compiler\n", 42, true, new JsonArray(), new JsonObject() } },
            { "nested", new JsonObject { { "pi", Math.PI }, { "big", 1e21 }, { "tab", "a\tb\u0001" } } },
        };
        string compact = document.ToText(), pretty = document.ToText(2);
        Console.WriteLine(compact);
        Console.WriteLine(pretty);
        var parsed = new JsonReader(pretty).Read();
        Console.WriteLine((parsed.ToText() == compact) + " " + ((JsonString)parsed["name"]).Value + " " + ((JsonNumber)parsed["tags"][2]).Value + " " + (parsed["missing"] == Json.Null) + " " + ((JsonArray)parsed["tags"]).Count + " " + ((JsonObject)parsed["nested"]).Count() + " " + ((JsonArray)parsed["tags"]).OfType<JsonString>().Count());
        foreach (var bad in new[] { "{\"a\":}", "[1,2", "tru", "{} x", "[1 2]", "\"\\u0041\\n\"", " [ ] ", "-1.5e2", "{\"a\":[{\"b\":null}]}" })
        {
            try { Console.Write(new JsonReader(bad).Read().ToText() + " ; "); }
            catch (FormatException e) { Console.Write("<" + e.Message + "> ; "); }
            catch (IndexOutOfRangeException) { Console.Write("<truncated> ; "); }
        }
        Console.WriteLine();
        try { _ = parsed["name"]["x"]; } catch (InvalidOperationException e) { Console.WriteLine(e.Message); }
    }
}
