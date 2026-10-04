using System;
public abstract class Shape
{
    public abstract Shape Clone();
    public virtual Shape Scale(double factor) => this;
    public virtual object Tag => "shape";
}
public class Circle : Shape
{
    public double Radius { get; init; }
    public override Circle Clone() => new Circle { Radius = Radius };
    public override Circle Scale(double factor) => new Circle { Radius = Radius * factor };
    public override string Tag => "circle";
}
public sealed class Ring : Circle
{
    public double Hole { get; init; }
    public override Ring Clone() => new Ring { Radius = Radius, Hole = Hole };
}
public static class Program
{
    public static void Main()
    {
        Shape shape = new Ring { Radius = 2, Hole = 1 };
        Shape clone = shape.Clone();
        Circle circle = new Circle { Radius = 1 };
        Circle scaled = circle.Scale(3);
        Ring ring = ((Ring)shape).Clone();
        Console.WriteLine(clone.GetType().Name + " " + scaled.Radius + " " + ring.Hole + " " + shape.Scale(2).GetType().Name + " " + shape.Tag + " " + circle.Tag.Length + " " + circle.Clone().Scale(2).Clone().Radius);
    }
}
