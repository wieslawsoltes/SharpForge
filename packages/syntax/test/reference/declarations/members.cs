class Members : IFoo, IBar<int>
{
    const int Limit = 10, Other = Limit * 2;
    private static readonly int[] table = { 1, 2, 3 }, empty = { };
    public int a, b = 2, c;
    volatile bool flag;
    internal protected string Name = "x";
    private protected int Guarded;
    unsafe fixed byte buffer[16];

    public Members() { }
    static Members() { }
    protected Members(int x) : base(x) { }
    private Members(int x, int y) : this(x) => Guarded = y;
    ~Members() { }

    public abstract void Abstract();
    public virtual int Virtual(int x) => x;
    public override string ToString() { return Name; }
    public sealed override int GetHashCode() => 0;
    public new void Hidden() { }
    static extern int Native(int handle);
    public static T Generic<T, U>(T value, U other) where T : class, new() where U : struct, IComparable<U> { return value; }
    public async Task<int> RunAsync(CancellationToken token = default) { return await Task.FromResult(1); }
    partial void OnChanged(string name);
    void IFoo.Explicit() { }
    int IBar<int>.Explicit(int value) => value;
    T IGeneric.Method<T>(T value) { return value; }

    public int Auto { get; set; }
    public int ReadOnly { get; }
    public int Initialized { get; private set; } = 5;
    public int Init { get; init; }
    public int Expression => a + b;
    public int Full { get { return a; } set { a = value; } }
    public int Bodied { get => a; set => a = value; }
    public abstract int AbstractProperty { get; protected set; }
    int IFoo.Property { get { return 0; } }
    string IBar<int>.Text => "t";
    public static int Static { get; } = 1;

    public event EventHandler Simple;
    public static event EventHandler<Args> First, Second;
    public event EventHandler Custom { add { Simple += value; } remove { Simple -= value; } }
    event EventHandler IFoo.E { add { } remove { } }
    event EventHandler I<int>.Generic { add => Simple += value; remove => Simple -= value; }

    public int this[int index] { get { return table[index]; } set { table[index] = value; } }
    public string this[string key, int offset = 0] => key;
    int IList.this[int index] { get => 0; set { } }

    public static Members operator +(Members x, Members y) { return x; }
    public static Members operator -(Members x) => x;
    public static Members operator ++(Members x) => x;
    public static Members operator --(Members x) => x;
    public static Members operator !(Members x) => x;
    public static Members operator ~(Members x) => x;
    public static bool operator true(Members x) => true;
    public static bool operator false(Members x) => false;
    public static Members operator *(Members x, int y) => x;
    public static Members operator /(Members x, int y) => x;
    public static Members operator %(Members x, int y) => x;
    public static Members operator &(Members x, Members y) => x;
    public static Members operator |(Members x, Members y) => x;
    public static Members operator ^(Members x, Members y) => x;
    public static Members operator <<(Members x, int y) => x;
    public static Members operator >>(Members x, int y) => x;
    public static Members operator >>>(Members x, int y) => x;
    public static bool operator ==(Members x, Members y) => true;
    public static bool operator !=(Members x, Members y) => false;
    public static bool operator <(Members x, Members y) => true;
    public static bool operator >(Members x, Members y) => false;
    public static bool operator <=(Members x, Members y) => true;
    public static bool operator >=(Members x, Members y) => false;
    public static Members operator checked +(Members x, int y) => x;
    public static implicit operator int(Members x) => 0;
    public static explicit operator Members(int x) { return null; }
    public static explicit operator checked long(Members x) => 0;
    static bool IEq<Members>.operator ==(Members x, Members y) => true;
    static explicit IConv<Members>.operator string(Members x) => "";
    public void operator +=(int y) { }
}
