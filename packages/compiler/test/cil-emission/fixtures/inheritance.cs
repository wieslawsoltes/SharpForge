using System;

interface IShape
{
    double Area();
    string Name { get; }
}

interface IScalable
{
    void Scale(double factor);
}

abstract class Shape : IShape
{
    protected readonly string label;

    protected Shape(string label)
    {
        this.label = label;
        Console.WriteLine("shape " + label);
    }

    public abstract double Area();
    public virtual string Name => "shape:" + label;

    public virtual string Describe()
    {
        return Name + " area " + Area();
    }
}

class Rectangle : Shape, IScalable
{
    protected double width, height;

    public Rectangle(double width, double height) : this("rectangle", width, height) { }

    protected Rectangle(string label, double width, double height) : base(label)
    {
        this.width = width;
        this.height = height;
    }

    public override double Area()
    {
        return width * height;
    }

    public void Scale(double factor)
    {
        width *= factor;
        height *= factor;
    }
}

sealed class Square : Rectangle
{
    public Square(double side) : base("square", side, side) { }

    public override string Name => "square!";

    public override string Describe()
    {
        return base.Describe() + " side " + width;
    }
}

class Circle : Shape
{
    readonly double radius;

    public Circle(double radius) : base("circle")
    {
        this.radius = radius;
    }

    public override double Area()
    {
        return 3 * radius * radius;
    }
}

class Program
{
    static double Total(IShape first, IShape second, IShape third)
    {
        return first.Area() + second.Area() + third.Area();
    }

    static void Rescale(Shape shape)
    {
        if (shape is IScalable scalable)
        {
            scalable.Scale(2);
            Console.WriteLine("scaled " + shape.Area());
        }
        else Console.WriteLine("fixed " + shape.Area());
    }

    static void Main()
    {
        Shape rectangleShape = new Rectangle(2, 3), squareShape = new Square(4), circleShape = new Circle(1);
        Console.WriteLine(rectangleShape.Describe());
        Console.WriteLine(squareShape.Describe());
        Console.WriteLine(circleShape.Describe());
        IShape contract = squareShape;
        Console.WriteLine(Total(rectangleShape, contract, circleShape));
        Console.WriteLine(contract.Name);
        Rescale(rectangleShape);
        Rescale(circleShape);
        object boxed = squareShape;
        Console.WriteLine(boxed is Rectangle);
        Console.WriteLine(boxed is Circle);
        Rectangle rectangle = boxed as Rectangle;
        Circle circle = boxed as Circle;
        Console.WriteLine(rectangle != null);
        Console.WriteLine(circle == null);
        Square square = (Square)boxed;
        Console.WriteLine(square.Name);
        try
        {
            Circle wrong = (Circle)boxed;
            Console.WriteLine(wrong.Name);
        }
        catch (InvalidCastException)
        {
            Console.WriteLine("invalid cast");
        }
        object number = 41;
        int unboxed = (int)number + 1;
        Console.WriteLine(unboxed);
        Console.WriteLine(number is int);
        Console.WriteLine(number is string);
    }
}
