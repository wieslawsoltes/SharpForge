public record Person(string Name, int Age);
public record Employee(string Name, int Age, string Company) : Person(Name, Age), IWorker;
record Empty;
record Braces { }
record class Explicit(int X) { public int Y { get; init; } }
public abstract record Shape<T>(T Id) where T : notnull
{
    public abstract double Area { get; }
}
public sealed record Circle<T>(T Id, double Radius) : Shape<T>(Id) where T : notnull
{
    public override double Area => 3.14 * Radius * Radius;
    public Circle(T id) : this(id, 1.0) { }
}
public readonly record struct Point(int X, int Y);
record struct Mutable { public int Value; }
public partial record Node;
public partial record Node { Node next; }
[System.Serializable] internal record Attributed([property: Key] int Id, [field: NonSerialized] string Tag = "x");

class Uses
{
    record Nested(int A);
    protected record struct NestedStruct(int A) : System.IDisposable { public void Dispose() { } }

    void M(Person p, Point q)
    {
        var a = p with { Name = "x", Age = 2 };
        var b = (p with { }).Name;
        var c = q with { X = q.X + 1 } with { Y = 0 };
        var d = p with { Name = p.Name ?? "n" } == p;
        int record = 1; record++;
        var with = 3; with = with + record;
        var e = with;
    }
}
