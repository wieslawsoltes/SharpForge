using System;
using System.Text;

public abstract record Block(string Id)
{
    // The synthesized `EqualityContract` named in a hand-written member.
    public string Contract => EqualityContract.Name;
    public bool SameKind(Block other) => other != null && EqualityContract == other.EqualityContract;
}

public record Heading(string Id, int Level, string Text) : Block(Id)
{
    // An override that calls the synthesized `PrintMembers` of the base record.
    protected override bool PrintMembers(StringBuilder builder)
    {
        if (base.PrintMembers(builder)) builder.Append(", ");
        builder.Append("Heading = ").Append(new string('#', Level)).Append(' ').Append(Text);
        return true;
    }
}

public record Chapter(string Id, int Level, string Text, int Number) : Heading(Id, Level, Text)
{
    public string Members()
    {
        var builder = new StringBuilder();
        bool any = PrintMembers(builder);
        return any + ": " + builder;
    }
}

public record Cell<T>(T Value)
{
    public string Dump()
    {
        var builder = new StringBuilder("[");
        PrintMembers(builder);
        return builder.Append(']').ToString() + " " + EqualityContract.Name;
    }
}

public sealed record Tagged<T>(T Value, string Tag) : Cell<T>(Value)
{
    protected override bool PrintMembers(StringBuilder builder)
    {
        builder.Append(Tag).Append(": ");
        return base.PrintMembers(builder);
    }
    protected override Type EqualityContract => typeof(Cell<T>);
}

public readonly record struct Pixel(int X, int Y)
{
    public string Raw()
    {
        var builder = new StringBuilder();
        return PrintMembers(builder) + " " + builder;
    }
}

public sealed record Empty
{
    public string Raw()
    {
        var builder = new StringBuilder("<");
        bool any = PrintMembers(builder);
        return builder.Append('>').ToString() + any + " " + EqualityContract.Name;
    }
}

public static class Program
{
    public static void Main()
    {
        Block heading = new Heading("h1", 2, "Intro");
        var chapter = new Chapter("c1", 1, "Start", 7);
        Console.WriteLine(heading);
        Console.WriteLine(chapter);
        Console.WriteLine(chapter.Members());
        Console.WriteLine(heading.Contract + " " + chapter.Contract + " " + heading.SameKind(chapter) + " " + heading.SameKind(new Heading("h2", 1, "x")));

        var cell = new Cell<int>(5);
        var tagged = new Tagged<string>("v", "tag");
        Console.WriteLine(cell.Dump() + " | " + tagged.Dump() + " | " + tagged);
        Console.WriteLine(new Cell<string>("v").Equals(tagged) + " " + tagged.Equals(new Cell<string>("v")) + " " + (tagged == new Tagged<string>("v", "tag")));
        Console.WriteLine(new Pixel(3, 4).Raw() + " | " + new Empty().Raw());
    }
}
