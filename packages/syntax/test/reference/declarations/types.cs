public abstract class Shape : Base, IComparable<Shape>, System.IDisposable
{
}
internal sealed class Leaf : Shape { }
public struct Point : IEquatable<Point>, IFormattable
{
    public int X;
    public int Y;
}
public readonly struct Meters { }
public ref struct Window { }
public interface IShape : IDisposable, IComparable
{
    double Area { get; }
    void Draw(int x, int y);
    event System.EventHandler Changed;
    int this[int index] { get; set; }
}
partial class Split { }
static partial class Helpers { }
unsafe class Raw { }
class Generic<T, U> : Base<T>, IPair<T, U> where T : class where U : struct { }
class Primary(int x, string name) : Base(x) { }
class Empty;
class Outer
{
    public class Middle
    {
        private struct Inner
        {
            enum Depth { One, Two }
            interface IDeep { }
            delegate void Callback(Depth depth);
        }
        protected internal class Second<T> { class Third<U> { } }
    }
}
