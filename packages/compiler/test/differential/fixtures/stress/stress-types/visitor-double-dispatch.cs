using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public interface IVisitor<out TResult>
{
    TResult VisitFile(FileNode file);
    TResult VisitFolder(FolderNode folder);
    TResult VisitLink(LinkNode link);
}

public abstract class Node
{
    protected Node(string name) { Name = name; }
    public string Name { get; }
    public FolderNode Parent { get; internal set; }
    public abstract TResult Accept<TResult>(IVisitor<TResult> visitor);
    public string Path => Parent == null ? Name : Parent.Path + "/" + Name;
    public int Depth => Parent?.Depth + 1 ?? 0;
}

public sealed class FileNode : Node
{
    public FileNode(string name, long size) : base(name) { Size = size; }
    public long Size { get; }
    public override TResult Accept<TResult>(IVisitor<TResult> visitor) => visitor.VisitFile(this);
}

public sealed class FolderNode : Node
{
    private readonly List<Node> children = new List<Node>();
    public FolderNode(string name, params Node[] nodes) : base(name) { foreach (var node in nodes) Add(node); }
    public IReadOnlyList<Node> Children => children;
    public FolderNode Add(Node node) { node.Parent = this; children.Add(node); return this; }
    public override TResult Accept<TResult>(IVisitor<TResult> visitor) => visitor.VisitFolder(this);
    public Node this[string name] => children.FirstOrDefault(child => child.Name == name);
}

public sealed class LinkNode : Node
{
    public LinkNode(string name, Node target) : base(name) { Target = target; }
    public Node Target { get; }
    public override TResult Accept<TResult>(IVisitor<TResult> visitor) => visitor.VisitLink(this);
}

public sealed class SizeVisitor : IVisitor<long>
{
    private readonly HashSet<Node> seen = new HashSet<Node>();
    public long VisitFile(FileNode file) => seen.Add(file) ? file.Size : 0;
    public long VisitFolder(FolderNode folder) => folder.Children.Sum(child => child.Accept(this));
    public long VisitLink(LinkNode link) => link.Target.Accept(this);
}

public sealed class PrintVisitor : IVisitor<StringBuilder>
{
    private readonly StringBuilder output = new StringBuilder();
    private int indent;
    private StringBuilder Line(string text) => output.Append(' ', indent * 2).Append(text).Append('\n');
    public StringBuilder VisitFile(FileNode file) => Line($"{file.Name} ({file.Size})");
    public StringBuilder VisitFolder(FolderNode folder)
    {
        Line(folder.Name + "/");
        indent++;
        foreach (var child in folder.Children.OrderBy(c => c is FolderNode ? 0 : 1).ThenBy(c => c.Name, StringComparer.Ordinal)) child.Accept(this);
        indent--;
        return output;
    }
    public StringBuilder VisitLink(LinkNode link) => Line(link.Name + " -> " + link.Target.Path);
}

public sealed class FindVisitor : IVisitor<IEnumerable<Node>>
{
    private readonly Func<Node, bool> predicate;
    public FindVisitor(Func<Node, bool> predicate) { this.predicate = predicate; }
    public IEnumerable<Node> VisitFile(FileNode file) { if (predicate(file)) yield return file; }
    public IEnumerable<Node> VisitFolder(FolderNode folder)
    {
        if (predicate(folder)) yield return folder;
        foreach (var child in folder.Children)
            foreach (var match in child.Accept(this))
                yield return match;
    }
    public IEnumerable<Node> VisitLink(LinkNode link) => predicate(link) ? new Node[] { link } : Enumerable.Empty<Node>();
}

public abstract class Shape
{
    public abstract string Collide(Shape other);
    public virtual string With(Circle circle) => "shape-circle";
    public virtual string With(Box box) => "shape-box";
}

public class Circle : Shape
{
    public override string Collide(Shape other) => other.With(this);
    public override string With(Circle circle) => "circle-circle";
    public override string With(Box box) => "box-circle";
}

public class Box : Shape
{
    public override string Collide(Shape other) => other.With(this);
    public override string With(Circle circle) => "circle-box";
    public override string With(Box box) => "box-box";
}

public sealed class RoundedBox : Box
{
    public override string With(Circle circle) => "circle-rounded";
    public new string With(Box box) => "hidden";
}

public static class Program
{
    public static void Main()
    {
        var readme = new FileNode("readme.md", 120);
        var source = new FolderNode("src", new FileNode("main.cs", 2048), new FileNode("util.cs", 512), new FolderNode("empty"));
        var root = new FolderNode("root", readme, source, new FolderNode("docs", new FileNode("guide.md", 4000), new LinkNode("readme", readme)));
        source.Add(new LinkNode("docs", root["docs"]));
        Console.Write(root.Accept(new PrintVisitor()));
        Console.WriteLine(root.Accept(new SizeVisitor()) + " " + source.Accept(new SizeVisitor()) + " " + source["main.cs"].Path + " " + source["main.cs"].Depth + " " + (source["nothing"] == null));
        IVisitor<IEnumerable<object>> finder = new FindVisitor(node => node.Name.EndsWith(".md") || node is LinkNode);
        Console.WriteLine(string.Join(" ", root.Accept(finder).Cast<Node>().Select(node => node.Path)));
        Console.WriteLine(string.Join(" ", root.Accept(new FindVisitor(node => node is FolderNode { Children.Count: 0 } or FileNode { Size: > 3000 })).Select(node => node.Name)));

        Shape[] shapes = { new Circle(), new Box(), new RoundedBox() };
        foreach (var left in shapes) Console.WriteLine(string.Join(" ", shapes.Select(right => left.Collide(right))));
        Console.WriteLine(new RoundedBox().With(new Box()) + " " + ((Box)new RoundedBox()).With(new Box()) + " " + ((Shape)new RoundedBox()).With(new Circle()));
    }
}
