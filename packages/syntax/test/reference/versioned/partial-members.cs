partial class C
{
    int count;
    partial void OnChanged();
    partial void OnChanged() { }
    static partial void Log(string message);
    public partial int Count { get; set; }
    public partial int Count { get => count; set => count = value; }
    public partial string this[int index] { get; }
    public partial string this[int index] => "";
    public partial C(int x);
    public partial C(int x) { count = x; }
    public partial event System.Action Changed;
    public partial event System.Action Changed { add { } remove { } }
    private partial bool TryGet(out int value);
    private partial bool TryGet(out int value) { value = 0; return true; }
    internal static partial T Create<T>() where T : new();
    protected virtual partial void Hook();
    int partial;
}
partial struct S { partial void M(); }
partial interface I { partial void M(); }
class partial { }
