using System;

class Shape
{
    public virtual string Name => "shape";
}

class Circle : Shape
{
    public override string Name => "circle";
}

interface IMarker
{
}

class Tagged : Shape, IMarker
{
    public override string Name => "tagged";
}

class Program
{
    static void Main()
    {
        Shape[] shapes = { new Shape(), new Circle(), new Tagged() };
        foreach (Shape shape in shapes) Console.WriteLine(shape.Name);
        IMarker[] markers = new IMarker[1];
        markers[0] = new Tagged();
        Console.WriteLine(markers[0] != null);
        object[] objects = { "text", 5, new Circle() };
        Console.WriteLine(objects.Length);
    }
}
