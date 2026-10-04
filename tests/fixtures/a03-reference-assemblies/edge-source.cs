using System;
using Alias = RefProbe.I<int>;

[assembly: System.Runtime.CompilerServices.ReferenceAssembly]
[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Friend")]
namespace System.Runtime.CompilerServices
{
    file class ReferenceAssemblyAttribute : Attribute { public ReferenceAssemblyAttribute() { } }
    file class InternalsVisibleToAttribute : Attribute { public InternalsVisibleToAttribute(string name) { } }
}
public class Contract { internal int Hidden() { return 1; } }

namespace RefProbe
{
    public interface I<T> { T Get(); T Value { get; } T this[int index] { get; } event Action Changed; }
    public class C : I<int>
    {
        int Alias.Get() { return 1; }
        int I<int>.Value { get { return 2; } }
        int I<int>.this[int index] { get { return index; } }
        event Action I<int>.Changed { add { } remove { } }
    }
    public class Outer<T> { public interface I<U> { U Get(T value); } }
    public class Nested : Outer<string>.I<int>
    {
        int Outer<string>.I<int>.Get(string value) { return 3; }
    }
    public interface ITuple<T> { T Get(); }
    public class Tuple : ITuple<(int first, string second)>
    {
        (int first, string second) ITuple<(int first, string second)>.Get() { return (1, "two"); }
    }
}
