using System;

namespace DeclarationMetadata;

public class Generic<T> where T : unmanaged
{
    public static bool Method<U>() where U : unmanaged => true;
}

public class References
{
    public static int Read(in int value) => value;
    public static int Readonly(ref readonly int value) => value;
    public static ref readonly int Return(ref int value) => ref value;
    public static void Scope(scoped ref int value) { value++; }
    public static void ScopedOut(scoped out int value) { value = 1; }
    public static int ScopedValue(scoped Span<int> values) => values.Length;
    public virtual int Virtual(in int value, ref readonly int second) => value + second;
}

public delegate int ReadonlyDelegate(ref readonly int value);

public static class Extensions
{
    extension(in int value) { public int ReadonlyValue => value; }
    extension(scoped ref int number) { public int ScopedValue { get => number; set => number = value; } }
    extension<T>(T[] values) where T : unmanaged { public T Head => values[0]; }
}
