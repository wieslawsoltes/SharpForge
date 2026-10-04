using System;
using System.Text;
public abstract record Event(int At)
{
    public abstract string Describe();
    public sealed override string ToString() => At + " " + Describe();
}
public sealed record Borrowed(int At, string Title) : Event(At) { public override string Describe() => "borrowed " + Title; }
public record Animal(string Name);
public record Bird(string Name, bool Flies) : Animal(Name)
{
    protected override bool PrintMembers(StringBuilder builder)
    {
        builder.Append("Bird ").Append(Name).Append(Flies ? " (flying)" : " (grounded)");
        return true;
    }
}
public record Plain(int A)
{
    protected virtual bool PrintMembers(StringBuilder builder) { builder.Append("custom A=" + A); return true; }
}
public static class Program
{
    public static void Main()
    {
        Event e = new Borrowed(3, "Dune");
        Console.WriteLine(e + " | " + new Bird("Tweety", true) + " | " + new Plain(1) + " | " + (new Borrowed(1, "x") == new Borrowed(1, "x")));
    }
}
