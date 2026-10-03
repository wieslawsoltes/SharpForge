enum Empty { }
enum Color { Red, Green, Blue }
public enum Flags : byte
{
    None = 0,
    A = 1 << 0,
    B = 1 << 1,
    [System.Obsolete] C = A | B,
    All = ~0,
}
enum Wide : ulong { Max = ulong.MaxValue };
delegate void Action();
public delegate TResult Func<in T, out TResult>(T arg) where T : notnull;
internal delegate ref readonly int RefGetter(ref int source, out int result, params object[] rest);
delegate int* PointerMaker(void* raw);
namespace N
{
    delegate void Nested<T>(T value) where T : class, new();
    class Holder { public delegate bool Predicate(int value); }
}
