public class Point(int x, int y)
{
    public int X { get; } = x;
    public int Sum() => x + y;
}
class Derived(int x, int y, string name) : Point(x, y), IName
{
    public string Name => name;
}
struct Pair<T>(T first, T second) where T : struct;
interface IMarker(int id);
class Empty();
class WithAttributes([Attr] in int value, params int[] rest) : Base();
readonly struct R(int a) { public int A => a; }
partial class Generic<T, U>(T t, U u = default) : Base<T>(t), IOne, ITwo<U> where T : class where U : new() { }
class Semicolon : Base;
struct Bare;
interface IBare;
