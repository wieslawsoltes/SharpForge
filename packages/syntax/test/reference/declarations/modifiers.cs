public class A { }
internal class B { }
public static class C { }
public abstract partial class D { }
public sealed class E { }
unsafe partial struct F { }
public readonly partial struct G { }
public ref partial struct H { }
class Members
{
    public int a;
    private int b;
    protected int c;
    internal int d;
    protected internal int e;
    private protected int f;
    internal protected int g;
    static readonly int h;
    readonly static int i;
    public const int j = 1;
    new int k;
    volatile int l;
    public new virtual void M1() { }
    protected internal abstract override void M2();
    public sealed override void M3() { }
    static extern void M4();
    public unsafe static void M5(int* p) { }
    extern static unsafe int M6(ref int a, out int b, params int[] c);
    public void M7(in int a, ref readonly int b, scoped ref int c, this int d) { }
    async void M8() { }
    public static async Task M9() { }
    partial void M10();
}
