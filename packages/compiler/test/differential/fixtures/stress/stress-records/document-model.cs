#nullable enable
using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Text;

var draft = new Document(new Meta("Notes", "ada"), ImmutableList.Create<Block>(
    new Heading(1, "Intro", 1),
    new Paragraph(2, "Records are immutable."),
    new ListBlock(3, ImmutableArray.Create("one", "two")) { Style = "bullets" }));
var edits = new Edit[]
{
    new Insert(1, new Paragraph(4, "Inserted early.") { Style = "lead" }),
    new Replace<Paragraph>(2, p => p with { Text = p.Text.ToUpperInvariant() }),
    new Replace<Heading>(1, h => h with { Level = h.Level + 1, Text = h.Text + "!" }),
    new Replace<ListBlock>(3, l => l with { Items = l.Items.Add("three") }),
    new Retitle("Notes v2"),
    new Replace<Heading>(2, h => h with { Level = 6 }),
    new Remove(4),
    new Remove(42),
};
var history = new List<Document> { draft };
foreach (var edit in edits)
{
    var next = Editor.Apply(history[^1], edit);
    Console.WriteLine($"{Editor.Name(edit),-18} rev {next.Meta.Revision} changed={next != history[^1]} same-instance={ReferenceEquals(next, history[^1])}");
    history.Add(next);
}
foreach (var block in history[^1].Blocks) Console.WriteLine("  " + block);
Console.WriteLine(history[^1].Meta + " | " + draft.Meta + " | copies " + Document.Copies);

var clone = draft with { };
var rebuilt = draft with { Blocks = draft.Blocks.RemoveAt(0).Insert(0, draft.Blocks[0]) };
Console.WriteLine((clone == draft) + " " + ReferenceEquals(clone.Blocks, draft.Blocks) + " " + (rebuilt == draft) + " " + rebuilt.Blocks.SequenceEqual(draft.Blocks)
    + " " + (draft.Meta == new Meta("Notes", "ada")) + " " + (draft.Meta == new Meta("Notes", "ada") { Revision = 1 }));

var list = (ListBlock)draft.Blocks[2];
var sameItems = new ListBlock(3, ImmutableArray.Create("one", "two")) { Style = "bullets" };
Paragraph heading = (Heading)draft.Blocks[0];
var retyped = heading with { Text = "Outro" };
Console.WriteLine((list == sameItems) + " " + (list == sameItems with { Style = null }) + " " + (list.GetHashCode() == sameItems.GetHashCode())
    + " " + retyped.GetType().Name + " " + retyped + " " + (heading == new Paragraph(1, "Intro")) + " " + (new Paragraph(1, "Intro") == heading with { }));
var nested = history[^1] with { Meta = history[^1].Meta with { Author = "grace", Revision = 0 } };
Console.WriteLine(nested.Meta + " " + (nested.Blocks == history[^1].Blocks) + " " + nested.Outline());

try { Console.WriteLine(new Heading(9, "bad", 7)); }
catch (ArgumentOutOfRangeException e) { Console.WriteLine("invalid heading: " + e.ParamName); }
var (title, author) = nested.Meta;
var (id, text, level) = (Heading)history[^1].Blocks[0];
Console.WriteLine($"{title}/{author} {id}:{text}:{level} " + string.Join(",", history.Select(d => d.Blocks.Count)) + " " + history.Distinct().Count()
    + " " + new HashSet<Block>(history.SelectMany(d => d.Blocks)).Count);

public abstract record Block(int Id)
{
    public string? Style { get; init; }
}

public record Paragraph(int Id, string Text) : Block(Id);

public sealed record Heading(int Id, string Text, int Level) : Paragraph(Id, Text)
{
    public int Level { get; init; } = Level is >= 1 and <= 6 ? Level : throw new ArgumentOutOfRangeException(nameof(Level));
}

public sealed record ListBlock(int Id, ImmutableArray<string> Items) : Block(Id)
{
    public bool Equals(ListBlock? other) => other is not null && base.Equals(other) && Items.SequenceEqual(other.Items);
    public override int GetHashCode() => HashCode.Combine(base.GetHashCode(), Items.Length);
    protected override bool PrintMembers(StringBuilder builder)
    {
        if (base.PrintMembers(builder)) builder.Append(", ");
        builder.Append("Items = [").AppendJoin('|', Items).Append(']');
        return true;
    }
}

public sealed record Meta(string Title, string Author)
{
    public int Revision { get; init; }
}

public sealed record Document(Meta Meta, ImmutableList<Block> Blocks)
{
    public static int Copies;
    private Document(Document original)
    {
        Meta = original.Meta;
        Blocks = original.Blocks;
        Copies++;
    }

    public string Outline() => string.Join(" > ", Blocks.Select(b => b switch
    {
        Heading { Level: var level, Text: var text } => new string('#', level) + text,
        Paragraph { Style: not null and var style } => style + ":p",
        Paragraph { Text.Length: var length } => "p" + length,
        ListBlock { Items: { IsDefaultOrEmpty: false } items } => "list" + items.Length,
        _ => "?",
    }));
}

public abstract record Edit;
public sealed record Insert(int Index, Block Block) : Edit;
public sealed record Remove(int Id) : Edit;
public sealed record Retitle(string Title) : Edit;
public sealed record Replace<T>(int Id, Func<T, T> Change) : Edit where T : Block;

public static class Editor
{
    public static string Name(Edit edit) => edit switch
    {
        Insert(var index, { Id: var id }) => $"insert #{id} at {index}",
        Remove(var id) => "remove #" + id,
        Retitle => "retitle",
        Replace<Heading>(var id, _) => "restyle heading #" + id,
        { } other => other.GetType().Name.Split('`')[0].ToLowerInvariant() + " " + other.GetType().GetGenericArguments()[0].Name,
    };

    public static Document Apply(Document document, Edit edit)
    {
        var bumped = document.Meta with { Revision = document.Meta.Revision + 1 };
        switch (edit)
        {
            case Insert(var index, var block) when index >= 0 && index <= document.Blocks.Count:
                return document with { Meta = bumped, Blocks = document.Blocks.Insert(index, block) };
            case Remove(var id) when document.Blocks.Find(b => b.Id == id) is { } victim:
                return document with { Meta = bumped, Blocks = document.Blocks.Remove(victim) };
            case Retitle(var title) when title != document.Meta.Title:
                return document with { Meta = bumped with { Title = title } };
            case Replace<Paragraph> replace:
                return Swap(document, bumped, replace);
            case Replace<Heading> replace:
                return Swap(document, bumped, replace);
            case Replace<ListBlock> replace:
                return Swap(document, bumped, replace);
            default:
                return document;
        }
    }

    private static Document Swap<T>(Document document, Meta bumped, Replace<T> replace) where T : Block
    {
        int index = document.Blocks.FindIndex(b => b.Id == replace.Id && b is T);
        if (index < 0) return document;
        T before = (T)document.Blocks[index], after = replace.Change(before);
        return before == after ? document : document with { Meta = bumped, Blocks = document.Blocks.SetItem(index, after) };
    }
}
