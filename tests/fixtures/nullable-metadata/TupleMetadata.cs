#nullable enable
using System;

namespace TupleMetadata;

public interface IContract<T> { }
public class Base<T> { }

public class Carrier<T> : Base<(int Id, string? Name)>, IContract<(int Count, string Label)>
    where T : IContract<(string Key, int Value)>
{
    public event Action<(int Code, string? Message)>? Changed;
    public event Action<(string Name, int Count)> Custom { add { } remove { } }
}

public class Outer<T>
{
    public class Nested : Base<(T Value, string? Label)> { }
}
