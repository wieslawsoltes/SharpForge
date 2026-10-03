class C
{
    int count;
    public int M() => 1;
    public void V() => System.Console.WriteLine();
    public static int S(int a, int b) => a + b;
    public T G<T>(T t) where T : class => t;
    public int P => count;
    public static string Q => "q";
    public int this[int i] => i * 2;
    public int this[int i, int j] => i + j;
    public static C operator +(C a, C b) => a;
    public static C operator -(C a) => a;
    public static implicit operator int(C c) => 1;
    public static explicit operator C(int i) => null;
    public static bool operator true(C c) => true;
    public static bool operator false(C c) => false;
    int I.M() => 2;
    int I.P => 3;
    int I.this[int i] => 4;
    public int Auto { get; } = 1;
    public string Name { get; set; } = "x";
    public static int Count { get; private set; } = 2 + 3;
    public int ReadOnly { get; }
    public System.Collections.Generic.List<int> L { get; } = new System.Collections.Generic.List<int> { 1 };
    public C() => count = 1;
    public C(int a) : this() => count = a;
    ~C() => count = 0;
    static C() => X = 1;
    public int A { get => count; set => count = value; }
    public int B { get => 1; }
    public int this[string s] { get => 1; set => count = value; }
    public event System.EventHandler E { add => count++; remove => count--; }
    public int R => throw null;
    public ref int RR => ref count;
    public ref int RM() => ref count;
    void L1() { int Local() => 1; }
    public abstract int Z => 0;
    public int W
        => 1;
}
