using System;
using System.Reflection;

[assembly: AssemblyVersion("1.0.0.0")]

namespace Fixture;

public class Box<T> { }
public class Pair<TFirst, TSecond> { }
public class Other<T> { }
public struct Cell<T> { }
public interface IContract<T> { }
public interface ILeft<T> : IContract<T> { }
public interface IRight<T> : IContract<T> { }
public interface IVariant<out T> { }
public class Derived<T> : Box<T>, ILeft<T>, IRight<T> { }
public class Reorder<TFirst, TSecond> : Box<Pair<TSecond, TFirst>> { }
public class Node<T> : Box<Node<T>>, IContract<Node<Node<T>>> { }
public class Constrained<T> where T : class { }

public class Outer<T>
{
    public class Inner<U> { }
    public class NonGenericInner { }
}

public unsafe class MethodOwner<T>
{
    public static Pair<T, U> M<U>(T value, U other) => new();

    public static void Shapes<U>(delegate* managed<T, U> transform, delegate* unmanaged[Cdecl]<int, int> native) { }

    public static void Nested(delegate* managed<delegate* managed<int, int>, ref int, int> transform) { }
}

