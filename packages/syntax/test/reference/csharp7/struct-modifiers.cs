readonly struct A { }
ref struct B { }
readonly ref struct C { }
public readonly struct D { public readonly int X; }
public ref struct E { }
public readonly ref struct F { }
readonly partial struct G { }
ref partial struct H { }
readonly ref partial struct I { }
public readonly ref partial struct J { }
unsafe readonly ref struct K { }
class N
{
    private protected int a;
    protected private int b;
    private protected void M() { }
    private protected int P { get; private protected set; }
    private protected class Nested { }
    private protected static readonly int c = 1;
    protected private virtual void V() { }
    public int Q { get; protected private set; }
    private protected N() { }
    private protected event System.Action Ev;
    private protected int this[int i] => i;
    private protected delegate void Del();
    private protected enum En { }
    private protected interface In { }
    readonly struct NestedReadonly { }
    ref struct NestedRef { }
    private readonly ref struct NestedBoth { }
    void Locals()
    {
        ref readonly int r = ref x;
        ref int s = ref x;
    }
    public void In(in int a, in N b) { }
    public ref readonly int RefReadonly() => ref x;
    public static void Ext(this in int a) { }
    public static void Ext2(this ref int a) { }
}
