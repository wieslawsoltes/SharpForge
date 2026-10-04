using System;
using System.Linq;

// Reduced from stress-language/caller-info-attributes: attribute constructors called in expanded `params` form and
// with optional parameters left out; constant expressions as named arguments.
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public sealed class NoteAttribute : Attribute
{
    public NoteAttribute(string name, int order = 7, params string[] tags) { Text = name + ":" + order + (tags.Length > 0 ? " #" + string.Join("#", tags) : ""); }
    public string Text { get; }
    public string Help { get; set; }
    public Type[] Kinds { get; set; }
}

[AttributeUsage(AttributeTargets.Class)]
public sealed class LimitsAttribute : Attribute
{
    public LimitsAttribute(params int[] values) { Sum = values.Sum(); Count = values.Length; }
    public int Sum { get; }
    public int Count { get; }
}

[Note("plain")]
[Note("ordered", 2)]
[Note("tagged", 3, "safe", "audited", Help = "ship " + nameof(Target))]
[Note("array", 4, new[] { "x" }, Kinds = new[] { typeof(int), typeof(string) })]
[Limits(1, 2, 3)]
public sealed class Target { }

[Limits]
public sealed class Empty { }

public static class Program
{
    public static void Main()
    {
        foreach (var note in Attribute.GetCustomAttributes(typeof(Target), typeof(NoteAttribute)).Cast<NoteAttribute>().OrderBy(n => n.Text, StringComparer.Ordinal))
        {
            Console.WriteLine(note.Text + " | " + (note.Help ?? "-") + " | " + (note.Kinds?.Length ?? 0));
        }
        var limits = (LimitsAttribute)Attribute.GetCustomAttribute(typeof(Target), typeof(LimitsAttribute));
        var none = (LimitsAttribute)Attribute.GetCustomAttribute(typeof(Empty), typeof(LimitsAttribute));
        Console.WriteLine(limits.Sum + "/" + limits.Count + " " + none.Sum + "/" + none.Count);
    }
}
