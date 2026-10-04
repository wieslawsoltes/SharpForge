public unsafe class RoslynFixture<T> where T : unmanaged
{
    public volatile int Volatile;
    public System.Collections.Generic.Dictionary<string, System.Collections.Generic.List<int>> Nested = new();
    public int? Nullable;
    public delegate* unmanaged[Cdecl]<int, void> Function;
    public int[,] Matrix = new int[1, 1];
    public int Init { get; init; }
    private int backing;
    public ref readonly int Readonly => ref backing;
    public int this[int index] => index;
    public U Generic<U>(T first, U second) => second;
}

public class RoslynFixtureVarargs
{
    public void Vararg(int first, __arglist) { }
}
