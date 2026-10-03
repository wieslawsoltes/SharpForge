interface ICovariant<out T> { T Get(); }
interface IContravariant<in T> { void Put(T value); }
interface IBoth<in TIn, out TOut> { TOut Map(TIn value); }
delegate TOut Converter<in TIn, out TOut>(TIn input);
class Constraints<A, B, C, D, E, F, G, H>
    where A : class
    where B : struct
    where C : new()
    where D : Base, IFoo, IBar<D>, new()
    where E : notnull
    where F : unmanaged
    where G : class?, IDisposable
    where H : A
{
    void M<T>() where T : default { }
    void N<T>() where T : allows ref struct { }
    void O<T>() where T : IDisposable, allows ref struct { }
    TResult P<TSource, TResult>(TSource source) where TSource : System.Collections.Generic.IEnumerable<TResult> where TResult : System.Enum { return default(TResult); }
}
struct Wrapper<T> where T : struct { T value; }
