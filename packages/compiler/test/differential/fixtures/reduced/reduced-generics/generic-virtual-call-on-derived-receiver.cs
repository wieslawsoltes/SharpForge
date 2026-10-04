using System;
using System.Collections.Generic;
using System.Linq;
public interface IVisitor<out TResult> { TResult VisitFile(FileNode file); TResult VisitFolder(FolderNode folder); }
public abstract class Node
{
    public string Name = "n";
    public abstract TResult Accept<TResult>(IVisitor<TResult> visitor);
}
public sealed class FileNode : Node { public override TResult Accept<TResult>(IVisitor<TResult> visitor) => visitor.VisitFile(this); }
public sealed class FolderNode : Node
{
    public List<Node> Children = new List<Node>();
    public override TResult Accept<TResult>(IVisitor<TResult> visitor) => visitor.VisitFolder(this);
}
public sealed class SizeVisitor : IVisitor<long>
{
    public long VisitFile(FileNode file) => 1;
    public long VisitFolder(FolderNode folder) => folder.Children.Sum(child => child.Accept(this));
}
public sealed class FindVisitor : IVisitor<IEnumerable<Node>>
{
    public IEnumerable<Node> VisitFile(FileNode file) { yield return file; }
    public IEnumerable<Node> VisitFolder(FolderNode folder)
    {
        yield return folder;
        foreach (var child in folder.Children)
            foreach (var match in child.Accept(this))
                yield return match;
    }
}
public static class Program
{
    public static void Main()
    {
        var root = new FolderNode();
        root.Children.Add(new FileNode());
        root.Children.Add(new FolderNode());
        IVisitor<IEnumerable<object>> finder = new FindVisitor();
        Console.WriteLine(root.Accept(new SizeVisitor()) + " " + root.Accept(finder).Cast<Node>().Count() + " " + string.Join("", root.Accept(new FindVisitor()).Select(node => node.Name)));
    }
}
