using System;
using System.Collections.Generic;
namespace Acme.Shapes {
  public interface IShape { double Area { get; } void Scale(double factor); event Action Resized; }
  public abstract class Shape : IShape, IDisposable {
    public const int Sides = 3; public const string Label = "shape"; private static readonly string tag = "s"; protected internal int count;
    public event Action Resized;
    public abstract double Area { get; }
    public string Name { get; set; }
    public virtual void Scale(double factor) { if (Resized != null) Resized(); }
    public void Dispose() { }
    protected Shape(int count) { this.count = count; Name = tag; }
    static Shape() { }
    public static Shape operator +(Shape a, Shape b) { return a; }
    public int this[int i] { get { return i; } set { } }
    public T Pick<T>(T a, ref int b, out string c, params object[] rest) where T : class, IShape, new() { c = null; return a; }
    internal class Nested<U> where U : struct { public U Value; public List<U> Items; public Dictionary<string, U[]> Map; }
  }
  public sealed class Circle : Shape, IComparable<Circle> {
    public Circle() : base(1) { }
    public override double Area { get { return 3; } }
    public sealed override void Scale(double factor) { }
    public int CompareTo(Circle other) { return 0; }
    void IDisposable_Like() { }
  }
  public struct Point { public int X; public int Y; public Point(int x, int y) { X = x; Y = y; } }
  public struct Empty { }
  public enum Color : byte { Red = 1, Green = 2, Both = Red | Green }
  [Flags] public enum Access { None, Read = 1, Write = 2 }
  public delegate int Transform(int x, ref string text);
  public class Box<T> : IEnumerable<T> where T : IComparable<T> {
    public T Value;
    public IEnumerator<T> GetEnumerator() { return null; }
    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() { return null; }
  }
  static class Program { static void Main() { } }
}
